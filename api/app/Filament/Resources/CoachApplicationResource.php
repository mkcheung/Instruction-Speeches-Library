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
use Filament\Notifications\Notification;
use Filament\Resources\Pages\PageRegistration;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Gate;

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

    /**
     * PLAN-ADMIN-DASHBOARD.md §7. Five flat, icon-less, arbitrarily
     * ordered nav items was the shipped state — no resource set a group,
     * an icon or a sort. Grouping matters more than it looks: the panel's
     * landing page is now a dashboard (§6.1), so the sidebar is the only
     * wayfinding an admin has, and "Moderation" (what needs attention
     * today) versus "People" (who the platform is made of) is the split
     * an actual moderation session follows.
     */
    protected static \UnitEnum|string|null $navigationGroup = 'People';

    protected static \BackedEnum|string|null $navigationIcon = 'heroicon-o-academic-cap';

    protected static ?int $navigationSort = 1;

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
        // PLAN-ADMIN-DASHBOARD.md §7. Filament tables already scroll
        // horizontally when they overflow, but `filament/tables`'
        // own layout doc is explicit that this is NOT sufficient: "on
        // mobile, the user is unable to see much information in a table
        // row at once without scrolling". `stackedOnMobile()` turns each
        // row into a labelled card below the `sm` breakpoint and adds a
        // sort dropdown, which is the difference between a moderator
        // being able to triage on a phone and not.
        //
        // Applied to all five resources identically rather than per
        // table, because the one thing worse than an unreadable mobile
        // table is four readable ones and a fifth nobody noticed.
            ->stackedOnMobile()
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
                    //
                    // §5.4's hole 7 (the ADMIN_VIEWED_COMMENTARY bug in
                    // `SpeechResource`) is the same bug as the one this
                    // comment block describes, found a second time in the
                    // other direction — so the read-only-modal shape is
                    // now spelled out identically in both files.
                    // `->modalSubmitAction(false)` is the piece that was
                    // missing here: with the work done in
                    // `modalContent()`, the modal's submit button called
                    // an action that does not exist and did nothing.
                    ->modalSubmitAction(false)
                    ->modalContent(function (CoachApplication $record) {
                        $signer = app(ApplicationDocumentUrlSigner::class);
                        $actor = auth()->user();
                        // Gated by EnsureUserIsAdmin before any
                        // /control-panel route (including this modal) is
                        // reachable at all — same "auth guaranteed
                        // non-null" guarantee as Controller::currentUser(),
                        // just enforced by a different middleware.
                        abort_if($actor === null, 403);

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
                // PLAN-ADMIN-DASHBOARD.md §5.4, hole 3: neither of these
                // two called `Gate::authorize` at all. This was the
                // subtlest of the plan's eight holes because the audit row
                // IS written (by `CoachApplicationDecisionService`), so
                // `audit_log` showed a complete, well-formed trail of
                // decisions that had never been authorized — the trail
                // actively made the gap harder to see.
                //
                // ⚠️ The ability is `role.assign`, targeted at the
                // APPLICANT rather than the application, and that choice
                // needs stating because `coachApplication.decide` would
                // read more naturally. Three reasons:
                //
                //  1. It is the power actually being exercised. Approval
                //     calls `RoleAssignmentService::assign($admin, $user,
                //     'coach')` — `role.assign` on that user is not a
                //     stand-in for the real check, it is the real check,
                //     and it now composes with the role allowlist §5.4
                //     added to that service.
                //  2. `UserPolicy::assign()` is a pure actor-tier
                //     predicate (`hasAnyRole(Role::ADMIN_TIER)`) with no
                //     target-specific clause, which is exactly §4's matrix
                //     row for "Approve / reject coach application" —
                //     admin ✅, super_admin ✅.
                //  3. It is registered AND in `$mustFallThrough`. A new
                //     `coachApplication.decide` string would need a
                //     `Gate::define` plus a `$mustFallThrough` entry in
                //     `AppServiceProvider`; without both, §5.7's standing
                //     rule applies and an unregistered ability is "an
                //     unconditional admin yes" from `Gate::before` — i.e.
                //     a Gate call that authorizes nothing, which is how
                //     this hole would get re-opened while looking fixed.
                //
                // `reject` authorizes the same ability even though it
                // assigns no role. The capability is one row in §4's
                // matrix, not two, and the predicate above answers
                // precisely the question being asked of it: "is this actor
                // permitted to decide this person's coach status."
                Action::make('approve')
                    ->requiresConfirmation()
                    ->schema([Textarea::make('reason')->label('Reason')])
                    ->action(function (CoachApplication $record, array $data) {
                        $actor = auth()->user();
                        abort_if($actor === null, 403);

                        try {
                            Gate::authorize('role.assign', $record->user);
                            app(CoachApplicationDecisionService::class)->approve($actor, $record, $data['reason'] ?? null);
                        } catch (AuthorizationException $e) {
                            // Caught rather than allowed to bubble, same as
                            // every action in `UserResource`, so a denial
                            // renders a Notification instead of Filament's
                            // raw 403 page mid-modal.
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
                    }),
                Action::make('reject')
                    ->requiresConfirmation()
                    ->schema([Textarea::make('reason')->label('Reason')->required()])
                    ->action(function (CoachApplication $record, array $data) {
                        $actor = auth()->user();
                        abort_if($actor === null, 403);

                        try {
                            Gate::authorize('role.assign', $record->user);
                            app(CoachApplicationDecisionService::class)->reject($actor, $record, $data['reason']);
                        } catch (AuthorizationException $e) {
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
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
