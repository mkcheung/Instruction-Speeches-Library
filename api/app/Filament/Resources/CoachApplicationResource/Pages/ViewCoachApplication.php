<?php

namespace App\Filament\Resources\CoachApplicationResource\Pages;

use App\Filament\Resources\CoachApplicationResource;
use App\Filament\Resources\UserResource;
use App\Models\ApplicationDocument;
use App\Models\AuditLog;
use App\Models\CoachApplication;
use App\Services\ApplicationDocumentUrlSigner;
use App\Services\CoachApplicationDecisionService;
use App\Support\AuditAction;
use App\Support\Role;
use Filament\Actions\Action;
use Filament\Forms\Components\Textarea;
use Filament\Infolists\Components\RepeatableEntry;
use Filament\Infolists\Components\RepeatableEntry\TableColumn;
use Filament\Infolists\Components\TextEntry;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\ViewRecord;
use Filament\Schemas\Components\Actions;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Components\Tabs;
use Filament\Schemas\Components\Tabs\Tab;
use Filament\Schemas\Schema;
use Filament\Support\Enums\FontFamily;
use Filament\Support\Icons\Heroicon;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\HtmlString;
use Livewire\Component;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * PLAN-COACH-APPLICATION-REVIEW-PAGE.md §5: one application's statement
 * and documents, with the Approve / Reject decision as header actions.
 *
 * Authorization is the resource's admin-tier `viewAny` / `view` overrides,
 * which Filament runs on mount and on every hydrate (§2.3) — hence no
 * `canAccess()` here, unlike `ViewUser`.
 *
 * Every closure below is written inline. A first-class callable such as
 * `UserResource::formatBytes(...)` breaks Filament's by-name parameter
 * injection, and since every tab renders server-side, that is a 500 on
 * every load.
 */
class ViewCoachApplication extends ViewRecord
{
    protected static string $resource = CoachApplicationResource::class;

    protected static ?string $breadcrumb = 'Review';

    /** §5.4: the signed URL is minted at click time and used at once. */
    private const DOWNLOAD_URL_TTL_SECONDS = 60;

    public function getTitle(): string
    {
        return 'Coach application: '.CoachApplicationResource::getRecordTitle($this->getRecord());
    }

    /**
     * ⚠️ Both top-level components are unconditional. An empty infolist
     * makes `ViewRecord` silently fall back to the resource's (empty)
     * `form()` — see `ViewUser::infolist()`.
     *
     * `STATUS_BADGES` is spelled `CoachApplicationResource::`, never
     * `self::`: here `self` is this page, and the constant lookup would be
     * an Error on every load.
     */
    public function infolist(Schema $schema): Schema
    {
        // The statement and the decision reason are applicant- / admin-
        // typed plain text with meaningful newlines. `e()` is mandatory: an
        // `Htmlable` skips Filament's sanitizer. Never `->markdown()`,
        // `->html()` or `->prose()` here — those only sanitize, so the
        // applicant's own markup would render.
        $multiline = fn (?string $state): HtmlString => new HtmlString(nl2br(e($state ?? ''), false));

        return $schema->components([
            Section::make('Application')
                ->columns(3)
                ->schema([
                    TextEntry::make('user.username')
                        ->label('Applicant')
                        ->url(fn (CoachApplication $record): string => UserResource::getUrl('view', ['record' => $record->user_id]))
                        ->placeholder('—'),
                    // First match wins. Erasing: `erasure_started_at` is
                    // set but the account is not yet anonymized (e.g.
                    // `DELETE /api/me`); the service then refuses Approve
                    // with a 409, so Approve is disabled and this badge
                    // explains why (§9).
                    TextEntry::make('account')
                        ->label('Account')
                        ->badge()
                        ->state(fn (CoachApplication $record): string => match (true) {
                            $record->user->anonymized_at !== null => 'Erased',
                            $record->user->erasure_started_at !== null => 'Erasing',
                            $record->user->deleted_at !== null => 'Deleted',
                            $record->user->suspended_at !== null => 'Suspended',
                            default => 'Active',
                        })
                        ->color(fn (string $state): string => match ($state) {
                            'Active' => 'success',
                            'Suspended' => 'warning',
                            default => 'danger',
                        }),
                    TextEntry::make('status')
                        ->badge()
                        ->formatStateUsing(fn (string $state): string => CoachApplicationResource::STATUS_BADGES[$state][0] ?? $state)
                        ->color(fn (string $state): string => CoachApplicationResource::STATUS_BADGES[$state][1] ?? 'gray'),
                    TextEntry::make('submitted_at')->label('Submitted')->dateTime(),
                    // A withdrawn application (the applicant's opt-out, or
                    // erasure step 6c) has no `decided_at` either, but it is
                    // not awaiting a decision.
                    TextEntry::make('decided_at')
                        ->label('Decided')
                        ->dateTime()
                        ->placeholder(fn (CoachApplication $record): string => $record->status === 'withdrawn' ? 'Withdrawn, never decided' : 'Undecided'),
                    TextEntry::make('decidedBy.username')->label('Decided by')->placeholder('—'),
                    TextEntry::make('decision_reason')
                        ->label('Decision reason')
                        ->formatStateUsing($multiline)
                        // Approve's reason is optional.
                        ->placeholder('No reason given.')
                        ->columnSpanFull()
                        ->visible(fn (CoachApplication $record): bool => $record->decided_at !== null),
                ]),
            // `->id()`, not `->key()`: a key is inheritable and would
            // prefix every nested key, breaking the Download action's
            // `documentsForReview.{i}` address. `->id()` also lets a
            // hand-typed `?tab=documents` work.
            Tabs::make('Review')
                ->persistTabInQueryString()
                ->columnSpanFull()
                ->tabs([
                    Tab::make('Request')
                        ->id('request')
                        ->schema([
                            TextEntry::make('statement')
                                ->hiddenLabel()
                                ->formatStateUsing($multiline)
                                ->placeholder(fn (CoachApplication $record): string => $record->user->anonymized_at !== null
                                    ? 'Erased at the applicant’s request.'
                                    : 'No statement was submitted.'),
                        ]),
                    Tab::make('Documents')
                        ->id('documents')
                        ->badge(fn (CoachApplication $record): int => $record->documentsForReview->count())
                        ->schema([
                            // `documentsForReview` is ordered by id: the
                            // nested Download action resolves its row by
                            // list position, re-read on every round trip.
                            RepeatableEntry::make('documentsForReview')
                                ->hiddenLabel()
                                ->placeholder('No documents uploaded.')
                                ->table([
                                    TableColumn::make('File'),
                                    TableColumn::make('Size'),
                                    TableColumn::make('Uploaded'),
                                    TableColumn::make('Status'),
                                    TableColumn::make('SHA-256'),
                                    TableColumn::make('Actions')->hiddenHeaderLabel(),
                                ])
                                ->schema([
                                    TextEntry::make('original_filename')->hiddenLabel(),
                                    // Not `Number::fileSize()`: ext-intl is missing on the dev host.
                                    // `byte_size` has no cast, hence the `(int)`.
                                    TextEntry::make('byte_size')
                                        ->hiddenLabel()
                                        ->formatStateUsing(fn (int|string $state): string => UserResource::formatBytes((int) $state)),
                                    TextEntry::make('created_at')->hiddenLabel()->dateTime(),
                                    TextEntry::make('state')
                                        ->hiddenLabel()
                                        ->badge()
                                        ->state(fn (ApplicationDocument $record): string => $record->displayState())
                                        ->color(fn (string $state): string => match ($state) {
                                            'Clean' => 'success',
                                            'Scanning' => 'info',
                                            'Quarantined', 'Scan failed' => 'danger',
                                            default => 'gray',
                                        }),
                                    TextEntry::make('sha256')
                                        ->hiddenLabel()
                                        ->fontFamily(FontFamily::Mono)
                                        ->limit(16)
                                        ->copyable()
                                        ->placeholder('—'),
                                    Actions::make([$this->downloadAction()]),
                                ]),
                        ]),
                ]),
        ]);
    }

    /**
     * §5.4: audit and sign at CLICK time, never at render. Tabs render
     * every panel server-side, so a presign-and-audit on render would log
     * "viewed" for documents nobody opened (§5.4 hole 7's bug again), and a
     * render-time URL would expire while the admin reads.
     *
     * `ADMIN_VIEWED_DOCUMENT` therefore means "this admin was issued a 60 s
     * download URL for these bytes". Rows written by the old modal meant
     * "the modal listing this document was rendered".
     *
     * `$record` is the item at that position of this application's own
     * `documentsForReview`, re-read server-side; a row that is no longer
     * downloadable has a hidden action, which cannot be mounted.
     */
    private function downloadAction(): Action
    {
        return Action::make('download')
            ->label('Download')
            ->icon(Heroicon::OutlinedArrowDownTray)
            ->visible(fn (ApplicationDocument $record): bool => $record->isDownloadable())
            ->action(function (ApplicationDocument $record, Component $livewire): void {
                $actor = auth()->user();
                abort_if($actor === null || ! $actor->hasAnyRole(Role::ADMIN_TIER), 403);

                // A clean row whose bytes are gone.
                if (! Storage::disk($record->disk)->fileExists($record->path)) {
                    Notification::make()->danger()->title('This document is no longer available.')->send();

                    return;
                }

                AuditLog::query()->create([
                    'actor_id' => $actor->id,
                    'action' => AuditAction::ADMIN_VIEWED_DOCUMENT,
                    'subject_type' => ApplicationDocument::class,
                    'subject_id' => $record->id,
                    'metadata' => ['sha256' => $record->sha256, 'application_id' => $record->application_id],
                    'created_at' => now(),
                ]);

                // `navigate: false`: `$action->redirect()` follows the
                // panel's SPA mode, under which `Alpine.navigate` would
                // XHR-fetch the PDF. A plain `window.location` navigation
                // to an `attachment` response downloads it and leaves this
                // page in place. Not a new tab: URL and server actions are
                // mutually exclusive, and a `window.open` after the round
                // trip has lost the click's user activation.
                $livewire->redirect(app(ApplicationDocumentUrlSigner::class)->presign($record, self::DOWNLOAD_URL_TTL_SECONDS), navigate: false);
            });
    }

    /**
     * PLAN-ADMIN-DASHBOARD.md §5.4, hole 3: neither of these two called
     * `Gate::authorize` at all. This was the subtlest of the plan's eight
     * holes because the audit row IS written (by
     * `CoachApplicationDecisionService`), so `audit_log` showed a complete,
     * well-formed trail of decisions that had never been authorized — the
     * trail actively made the gap harder to see.
     *
     * ⚠️ The ability is `role.assign`, targeted at the APPLICANT rather
     * than the application, and that choice needs stating because
     * `coachApplication.decide` would read more naturally. Three reasons:
     *
     *  1. It is the power actually being exercised. Approval calls
     *     `RoleAssignmentService::assign($admin, $user, 'coach')` —
     *     `role.assign` on that user is not a stand-in for the real check,
     *     it is the real check, and it now composes with the role allowlist
     *     §5.4 added to that service.
     *  2. `UserPolicy::assign()` is a pure actor-tier predicate
     *     (`hasAnyRole(Role::ADMIN_TIER)`) with no target-specific clause,
     *     which is exactly §4's matrix row for "Approve / reject coach
     *     application" — admin ✅, super_admin ✅.
     *  3. It is registered AND in `$mustFallThrough`. A new
     *     `coachApplication.decide` string would need a `Gate::define` plus
     *     a `$mustFallThrough` entry in `AppServiceProvider`; without both,
     *     §5.7's standing rule applies and an unregistered ability is "an
     *     unconditional admin yes" from `Gate::before` — i.e. a Gate call
     *     that authorizes nothing, which is how this hole would get
     *     re-opened while looking fixed.
     *
     * `reject` authorizes the same ability even though it assigns no role.
     * The capability is one row in §4's matrix, not two, and the predicate
     * above answers precisely the question being asked of it: "is this
     * actor permitted to decide this person's coach status."
     *
     * Moved here from the list's row actions
     * (PLAN-COACH-APPLICATION-REVIEW-PAGE.md §5.5). Both are visible only
     * while undecided; a hidden or disabled action cannot be mounted, and
     * `->visible()` / `->disabled()` are re-evaluated server-side on every
     * round trip. After a success the service refreshes `$record` in place,
     * so the badge updates and both buttons disappear in the same response.
     *
     * @return array<Action>
     */
    protected function getHeaderActions(): array
    {
        $undecided = fn (CoachApplication $record): bool => in_array($record->status, CoachApplication::UNDECIDED_STATUSES, true);

        return [
            Action::make('approve')
                ->color('success')
                ->requiresConfirmation()
                ->schema([
                    Textarea::make('reason')
                        ->label('Reason (optional)')
                        // `decision_reason` is VARCHAR(1000): Postgres
                        // would raise a QueryException the catch misses.
                        ->maxLength(1000)
                        ->helperText('Sent to the applicant verbatim.'),
                ])
                ->visible($undecided)
                ->disabled(fn (CoachApplication $record): bool => self::approvalBlockedReason($record) !== null)
                ->tooltip(fn (CoachApplication $record): ?string => self::approvalBlockedReason($record))
                ->action(fn (CoachApplication $record, array $data) => $this->decide('approve', $record, $data['reason'] ?? null)),
            Action::make('reject')
                ->color('danger')
                ->requiresConfirmation()
                ->schema([
                    Textarea::make('reason')
                        ->label('Reason')
                        ->required()
                        ->maxLength(1000)
                        ->helperText('Sent to the applicant verbatim.'),
                ])
                ->visible($undecided)
                ->action(fn (CoachApplication $record, array $data) => $this->decide('reject', $record, $data['reason'])),
        ];
    }

    /**
     * Mirrors the decision service's two approve-only 409 guards — Q3's
     * clean document (§7) and §9's erasure gate — so Approve is disabled,
     * with this as its tooltip, rather than offered as a certain refusal.
     * Reject has neither guard: it grants nothing.
     */
    private static function approvalBlockedReason(CoachApplication $record): ?string
    {
        return match (true) {
            ! $record->hasDownloadableDocument() => 'Approval needs at least one clean document.',
            $record->user->erasure_started_at !== null => 'The applicant is erasing their account.',
            default => null,
        };
    }

    /** The one body behind Approve and Reject; hole 3's Gate is the first thing it runs. */
    private function decide(string $verb, CoachApplication $record, ?string $reason): void
    {
        $actor = auth()->user();
        abort_if($actor === null, 403);

        try {
            Gate::authorize('role.assign', $record->user);
            $decisions = app(CoachApplicationDecisionService::class);

            if ($verb === 'approve') {
                $decisions->approve($actor, $record, $reason);
                $title = 'Approved: '.CoachApplicationResource::getRecordTitle($record).' is now a coach.';
            } else {
                $decisions->reject($actor, $record, $reason);
                $title = 'Rejected: '.CoachApplicationResource::getRecordTitle($record).'.';
            }

            Notification::make()->success()->title($title)->send();
        } catch (AuthorizationException|HttpException $e) {
            // HttpException: a 409 from the decision service (someone else
            // decided first, or a guard the disabled Approve mirrors fired
            // in a race) or the 422 self-assignment. Caught rather than
            // allowed to bubble, same as every action in `UserResource`, so
            // a denial renders a Notification instead of Filament's raw 403
            // page mid-modal. The refresh stops a stale page offering a
            // decided decision.
            $record->refresh();
            Notification::make()->danger()->title($e->getMessage())->send();
        }
    }
}
