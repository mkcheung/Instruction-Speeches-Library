<?php

namespace App\Filament\Resources;

use App\Filament\Resources\SpeechResource\Pages\ManageSpeeches;
use App\Models\Annotation;
use App\Models\AuditLog;
use App\Models\Speech;
use App\Support\AuditAction;
use Filament\Actions\Action;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\PageRegistration;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;

/**
 * STEP-12-admin-portal.md demo steps 8-10: "open any speech, see every
 * annotation grouped by reviewer — the join the legacy schema's missing
 * author column made unwritable"; "take down a speech."
 *
 * Every row view and every takedown writes to `audit_log` here in the
 * controller/action layer (never inside a Policy, per §14's own rule) —
 * see `viewSpeech`/`takedown` below.
 */
class SpeechResource extends Resource
{
    protected static ?string $model = Speech::class;

    protected static ?string $navigationLabel = 'Speeches';

    public static function form(Schema $schema): Schema
    {
        return $schema->components([]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn ($query) => $query->withTrashed()->with(['user', 'reviews.reviewer']))
            ->columns([
                TextColumn::make('title'),
                TextColumn::make('user.username')->label('Speaker'),
                TextColumn::make('deleted_at')->label('Taken down')->dateTime(),
                TextColumn::make('reviews_count')->counts('reviews')->label('Reviews'),
            ])
            ->recordActions([
                Action::make('viewAnnotations')
                    ->label('View annotations by reviewer')
                    ->modalContent(fn (Speech $record) => view('filament.speech-annotations-by-reviewer', [
                        // Grouped by reviewer_id — the exact join the
                        // legacy schema's missing author column made
                        // unwritable (STEP-12.md demo step 8). `Review`
                        // has no inverse `annotations()` relation anywhere
                        // in this codebase (Annotation::belongsTo(Review)
                        // is one-directional by design) — every existing
                        // caller queries `Annotation::where('review_id', ...)`
                        // directly (ReviewService, SeedAnnotationsCommand),
                        // so this follows the same convention rather than
                        // adding a new relation to a heavily-used model.
                        'groups' => $record->reviews()
                            ->with('reviewer')
                            ->get()
                            ->groupBy('reviewer_id')
                            ->map(fn ($reviews) => [
                                'reviewer' => $reviews->first()->reviewer,
                                'annotations' => $reviews->flatMap(
                                    fn ($review) => Annotation::query()->where('review_id', $review->id)->get()
                                ),
                            ]),
                    ]))
                    ->action(function (Speech $record) {
                        AuditLog::query()->create([
                            'actor_id' => auth()->id(),
                            'action' => AuditAction::ADMIN_VIEWED_COMMENTARY,
                            'subject_type' => Speech::class,
                            'subject_id' => $record->id,
                            'metadata' => [],
                            'created_at' => now(),
                        ]);
                    }),
                Action::make('takedown')
                    ->label('Take down')
                    ->requiresConfirmation()
                    ->visible(fn (Speech $record) => ! $record->trashed())
                    ->action(function (Speech $record) {
                        $record->delete();

                        AuditLog::query()->create([
                            'actor_id' => auth()->id(),
                            'action' => AuditAction::SPEECH_TAKEN_DOWN,
                            'subject_type' => Speech::class,
                            'subject_id' => $record->id,
                            'metadata' => [],
                            'created_at' => now(),
                        ]);

                        Notification::make()->success()->title('Speech taken down.')->send();
                    }),
            ]);
    }

    /**
     * @return array<string, PageRegistration>
     */
    public static function getPages(): array
    {
        return [
            'index' => ManageSpeeches::route('/'),
        ];
    }
}
