<?php

namespace App\Filament\Resources;

use App\Filament\Resources\CoachApplicationResource\Pages\ManageCoachApplications;
use App\Models\ApplicationDocument;
use App\Models\AuditLog;
use App\Models\CoachApplication;
use App\Services\ApplicationDocumentUrlSigner;
use App\Services\CoachApplicationDecisionService;
use App\Support\AuditAction;
use Filament\Actions\Action;
use Filament\Forms\Components\Textarea;
use Filament\Resources\Pages\PageRegistration;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

/**
 * STEP-12-admin-portal.md demo steps 3-5: the queue, oldest-submitted-
 * first, sandboxed-origin PDF viewer, approve/reject with a reason.
 *
 * ⚠️ The PDF itself is NEVER rendered inline on this page — only
 * metadata + hash. "View PDF" opens
 * App\Services\ApplicationDocumentUrlSigner's signed URL in a new tab,
 * which forces `Content-Disposition: attachment` (see
 * App\Http\Controllers\ApplicationDocumentDownloadController) — that is
 * the entire non-negotiable this resource exists to honor.
 */
class CoachApplicationResource extends Resource
{
    protected static ?string $model = CoachApplication::class;

    protected static ?string $navigationLabel = 'Coach applications';

    public static function form(Schema $schema): Schema
    {
        return $schema->components([
            Textarea::make('decision_reason')->label('Decision reason')->required(),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn ($query) => $query->whereIn('status', ['submitted', 'under_review'])->orderBy('submitted_at'))
            ->columns([
                TextColumn::make('user.username')->label('Applicant'),
                TextColumn::make('status')->badge(),
                TextColumn::make('submitted_at')->label('Submitted')->dateTime()->sortable(),
                TextColumn::make('documents_count')->counts('documents')->label('Docs'),
            ])
            ->filters([
                SelectFilter::make('status')->options([
                    'submitted' => 'Submitted',
                    'under_review' => 'Under review',
                ]),
            ])
            ->recordActions([
                Action::make('viewDocuments')
                    ->label('View documents')
                    // Was a plain `->action()` that computed a signed URL
                    // per document and discarded the return value —
                    // clicking "View documents" did nothing visible in the
                    // browser, and it wrote an ADMIN_VIEWED_DOCUMENT audit
                    // row for a document the admin was never actually
                    // shown. Found by two independent `/code-review`
                    // finder angles. Fixed by rendering an actual modal
                    // with real `<a>` links to each signed URL — matching
                    // `SpeechResource::viewAnnotations`'s existing
                    // `modalContent()` precedent for the same "show
                    // related data via a Blade view" shape, and each link
                    // still opens as its own signed-URL download in a new
                    // tab (STEP-12.md demo step 4), never inline on this
                    // page's own origin.
                    ->modalContent(function (CoachApplication $record) {
                        $signer = app(ApplicationDocumentUrlSigner::class);
                        $actor = auth()->user();

                        $documents = $record->documents()->where('status', 'clean')->get()->map(function (ApplicationDocument $document) use ($signer, $actor) {
                            AuditLog::query()->create([
                                'actor_id' => $actor->id,
                                'action' => AuditAction::ADMIN_VIEWED_DOCUMENT,
                                'subject_type' => ApplicationDocument::class,
                                'subject_id' => $document->id,
                                'metadata' => ['sha256' => $document->sha256],
                                'created_at' => now(),
                            ]);

                            return ['document' => $document, 'url' => $signer->presign($document)];
                        });

                        return view('filament.coach-application-documents', ['documents' => $documents]);
                    }),
                Action::make('approve')
                    ->requiresConfirmation()
                    ->schema([Textarea::make('reason')->label('Reason')])
                    ->action(function (CoachApplication $record, array $data) {
                        app(CoachApplicationDecisionService::class)->approve(auth()->user(), $record, $data['reason'] ?? null);
                    }),
                Action::make('reject')
                    ->requiresConfirmation()
                    ->schema([Textarea::make('reason')->label('Reason')->required()])
                    ->action(function (CoachApplication $record, array $data) {
                        app(CoachApplicationDecisionService::class)->reject(auth()->user(), $record, $data['reason']);
                    }),
            ]);
    }

    /**
     * @return array<string, PageRegistration>
     */
    public static function getPages(): array
    {
        return [
            'index' => ManageCoachApplications::route('/'),
        ];
    }
}
