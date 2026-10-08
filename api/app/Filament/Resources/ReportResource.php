<?php

namespace App\Filament\Resources;

use App\Filament\Resources\ReportResource\Pages\ManageReports;
use App\Models\AuditLog;
use App\Models\Report;
use App\Models\Review;
use App\Models\Speech;
use App\Support\AuditAction;
use App\Support\Role;
use Filament\Actions\Action;
use Filament\Forms\Components\Textarea;
use Filament\Infolists\Components\TextEntry;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\PageRegistration;
use Filament\Resources\Resource;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Enums\Width;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Gate;

/**
 * STEP-12-admin-portal.md: "the report queue (from step 11)." Reuses
 * STEP-11's `reports` table as-is (STEP-12-FROZEN-CONTRACT.md §10 —
 * "already correct and needs no new code" beyond this admin surface).
 *
 * PLAN-ADMIN-DASHBOARD.md §5.4, hole 4: `resolve`/`dismiss` were "the
 * only moderation verbs in the panel with NEITHER a `Gate::authorize` NOR
 * an audit write — the class does not even import `AuditLog`." Both are
 * fixed below. The missing import was the tell: `UserResource` and
 * `CoachApplicationResource` each had at least one of the two halves, so
 * this file was not a rule being bent, it was a rule nobody had applied
 * here at all.
 *
 * §5.7 had to land first for the audit half to be writable: no
 * `AuditAction` constant covered report resolution, so
 * `REPORT_RESOLVED`/`REPORT_DISMISSED` were added in the same change as
 * these two call sites — per that section's own instruction not to add
 * constants without callers, and not to add callers that hand-type
 * strings.
 *
 * ---------------------------------------------------------------------
 * PLAN-ADMIN-DASHBOARD.md §6.4 (Phase 2b) — "add the missing context"
 * ---------------------------------------------------------------------
 *
 * §6.4's complaint, verbatim: "An admin sees `reportable_type` and
 * **cannot tell which record was reported**, nor read `detail` (the
 * reporter's free text, in `$fillable` but not in the columns — the
 * single most useful field)."
 *
 * Both halves of that were literally true. The table held four columns —
 * `reportable_type`, `reason`, `state`, `created_at` — so the whole of a
 * report's substance rendered as the string `App\Models\Speech`. A
 * moderator could resolve or dismiss a report, write an audit row about
 * it, and never learn what it was about. Four additions close it:
 *
 *  1. **`detail`** — the reporter's own words. Truncated in the queue
 *     (full text on hover), unabridged in the context modal.
 *  2. **A reporter column.** `reports.reporter_id` is
 *     `ON DELETE SET NULL` — the migration's own reasoning is that "a
 *     report must survive the reporter's account being erased later" —
 *     so this column is placeholder-backed rather than assumed present.
 *  3. **A deep link to the reported record**, polymorphic over the two
 *     types `Report::REPORTABLE_TYPES` actually resolves. See
 *     `reportableContext()` for the resolution rules and the tombstones.
 *  4. **A context modal** carrying everything a resolve/dismiss decision
 *     needs in one place: reporter, reportable summary, reason, detail,
 *     state and — for an already-closed report — resolver, resolved_at
 *     and resolution_note, three columns `resolve` has written since
 *     STEP-12 and nothing in the panel has ever read back.
 *
 * The queue stays **oldest-first** (`modifyQueryUsing` below) and keeps
 * its state filter. That ordering is not cosmetic: it is what
 * `reports_state_created_at_index` was built to serve, and it is the
 * difference between a queue and a pile.
 *
 * ⚠️ WHAT §6.4 DELIBERATELY DOES NOT DO: add `User` to
 * `Report::REPORTABLE_TYPES`. §11.4 holds that open as a question for the
 * product owner, and §12 ranks it first among the items "closer to
 * defects than features" — today "abuse via bio, username, avatar or
 * connection requests cannot be reported", so the queue this panel exists
 * to work has no inbound signal for any of it. Adding the type changes
 * `ReportController`'s validated contract and the public API, not this
 * resource, so it is not done here. What this file does instead is refuse
 * to pretend: an unrecognised `reportable_type` renders a NAMED
 * tombstone, because `reports.reportable_type` carries **no CHECK
 * constraint** (unlike `reason` and `state`, which do) — only the
 * controller narrows it, so this class cannot assume it is narrow.
 *
 * ⚠️ NO NEW `AuditAction` CONSTANT for opening the context modal, and
 * that is a decision rather than an oversight. The three §6.3 read
 * surfaces on `SpeechResource` audit because each one DISCLOSES content —
 * a transcript, a presigned bearer URL, a coach's private commentary.
 * This modal discloses only columns of the `reports` row the admin is
 * already looking at, plus the reported record's title. The reportable's
 * actual content stays behind `SpeechResource`'s audited actions, which
 * is exactly where the deep link sends them. Adding
 * `admin.viewed_report` would also mean editing
 * `app/Support/AuditAction.php`, whose own docblock forbids constants
 * added ahead of a caller that needs them.
 */
class ReportResource extends Resource
{
    protected static ?string $model = Report::class;

    /**
     * PLAN-ADMIN-DASHBOARD.md §7. Five flat, icon-less, arbitrarily
     * ordered nav items was the shipped state — no resource set a group,
     * an icon or a sort. Grouping matters more than it looks: the panel's
     * landing page is now a dashboard (§6.1), so the sidebar is the only
     * wayfinding an admin has, and "Moderation" (what needs attention
     * today) versus "People" (who the platform is made of) is the split
     * an actual moderation session follows.
     */
    protected static \UnitEnum|string|null $navigationGroup = 'Moderation';

    protected static \BackedEnum|string|null $navigationIcon = 'heroicon-o-flag';

    protected static ?int $navigationSort = 1;

    protected static ?string $navigationLabel = 'Reports';

    /**
     * §6.4's hard case, and what makes the deep link non-trivial: **the
     * reported record may not be there any more.**
     *
     * `reportable_type`/`reportable_id` is a bare morph pair with NO
     * foreign key — the migration's own note is that it mirrors
     * `notifications.notifiable`, "the established precedent in this
     * schema for a target that can be more than one model". Nothing in
     * the database makes a report's target exist, and three separate
     * mechanisms in this codebase remove one:
     *
     *  1. **`Speech` uses `SoftDeletes`,** and this panel's own
     *     `takedown` action is what sets `deleted_at`. So the single most
     *     likely state of a reported speech when a moderator opens the
     *     queue — someone already acted on it — is exactly the state in
     *     which `$report->reportable` returns **null**, because the morph
     *     resolves through the default global scope. Reading
     *     `$report->reportable->title` would therefore 500 on the happy
     *     path of a two-admin workflow. That is why this method never
     *     touches the `reportable` relation and queries
     *     `Speech::withTrashed()` by primary key instead — the same
     *     escape `AnnotationController`, `TranscriptController` and
     *     `PurgeSpeechMedia` already use.
     *  2. **A speech can be hard-deleted** (`PurgeSpeechMedia` after
     *     §5.6's quarantine window, or `PrivacyEraseCommand`), after
     *     which even `withTrashed()` finds nothing. The report row
     *     survives it — that is the point of a report row — so this
     *     returns a tombstone naming the id rather than an empty cell
     *     that reads as "nothing was reported".
     *  3. **A `Review` is never soft-deleted,** so a review report is
     *     either present or gone outright. Its CONTEXT can still be
     *     partly missing: `reviewer_id` is nullable (voice erasure nulls
     *     it) and `Review::$speech` is documented as resolving to
     *     **null for a trashed speech** — its `@property-read` override
     *     says so explicitly and names the admin takedown path as the
     *     cause — so the parent speech gets the same `withTrashed()`
     *     lookup as case 1 rather than a relation read.
     *
     * One branch below is required by the types without being reachable,
     * and it is worth naming so nobody deletes it as dead code or wastes
     * a test trying to exercise it: a Review whose parent speech is
     * HARD-gone. `find()` is nullable so the branch must exist, but
     * `reviews.speech_id` is `ON DELETE CASCADE`, so a force-deleted
     * speech takes its reviews with it and such a report lands in the
     * "Review no longer exists" branch instead.
     *
     * The returned `url` points at the **Speeches resource**, never at
     * one of its actions. `SpeechResource` grew five record actions in
     * §6.3 (`viewTranscript`, `viewAnnotations`, `viewVideo`, `takedown`,
     * `restore`); linking to any one of them would be a dependency on a
     * name that is not a route and that §6.3 is still reshaping. `search`
     * is the query-string alias Filament itself binds `$tableSearch` to
     * (`ListRecords.php:48` — `#[Url(as: 'search')]`), and `title` is the
     * one searchable column on that table — §6.3 added `->searchable()`
     * for precisely this reason: "a moderator working from a report has
     * the title and nothing else to find the row by." That table also
     * loads trashed rows, so the link keeps working after a takedown.
     *
     * A review report deep-links to its PARENT SPEECH rather than
     * nowhere, because no Filament resource exists for `Review` and the
     * speeches table is where the reported commentary is actually
     * readable: `viewAnnotations` renders a review's annotations, voice
     * notes and essay, which §6.3 promoted to v1 specifically because
     * `REPORTABLE_TYPES` admits a Review.
     *
     * COST, stated rather than hidden: one or two primary-key lookups per
     * rendered row, and the table calls this twice per row because
     * `->state()` and `->url()` are separate closures. `reportable` is
     * deliberately NOT added to the table's `with()` — eager-loading a
     * morphTo re-applies the SoftDeletes scope and reintroduces case 1,
     * which is the entire bug. §10 defers this class of optimisation for
     * the same reason it defers the speeches index: these are tables you
     * can `SELECT *` in a millisecond.
     *
     * @return array{summary: string, url: string|null}
     */
    private static function reportableContext(Report $report): array
    {
        $id = $report->reportable_id;

        if ($report->reportable_type === Speech::class) {
            $speech = Speech::withTrashed()->find($id);

            if ($speech === null) {
                return [
                    'summary' => "Speech #{$id} (no longer exists)",
                    'url' => null,
                ];
            }

            return [
                'summary' => self::describeSpeech($speech),
                'url' => self::speechUrl($speech),
            ];
        }

        if ($report->reportable_type === Review::class) {
            $review = Review::query()->find($id);

            if ($review === null) {
                return [
                    'summary' => "Review #{$id} (no longer exists)",
                    'url' => null,
                ];
            }

            // `Review` has no Filament resource of its own, so §6.4's
            // "surface enough context to identify it" is met by the two
            // facts a moderator needs in order to find the commentary:
            // WHOSE review it is, and WHICH speech it sits on.
            $reviewer = $review->reviewer;
            $speech = Speech::withTrashed()->find($review->speech_id);

            return [
                'summary' => sprintf(
                    'Review #%d by %s, on %s',
                    $review->id,
                    // `reviewer_id` is genuinely nullable — voice erasure
                    // nulls it, which is why `Review`'s docblock
                    // deliberately excludes `reviewer` from its
                    // `@property-read` non-null overrides. A real state,
                    // not defensive padding.
                    $reviewer === null ? 'a deleted reviewer' : '@'.$reviewer->username,
                    $speech === null
                        ? "speech #{$review->speech_id} (no longer exists)"
                        : self::describeSpeech($speech),
                ),
                'url' => $speech === null ? null : self::speechUrl($speech),
            ];
        }

        // Not reachable through `ReportController`, which resolves
        // `reportable_type` server-side against `REPORTABLE_TYPES` and
        // never trusts a client-supplied class string. It IS reachable
        // through the database: `reports.reportable_type` is a plain
        // `VARCHAR(255)` with no CHECK, so a seeder, a console command,
        // or a reportable type added to the API but not to this file
        // lands here. Naming the type is what makes that diagnosable
        // instead of mysterious.
        return [
            'summary' => sprintf('Unrecognised report target (%s #%d)', $report->reportable_type, $id),
            'url' => null,
        ];
    }

    /**
     * One-line identity for a speech, trashed or not.
     *
     * `$speech->user` is read with no null guard on purpose, and the
     * reason is recorded in `phpstan.neon`: `Speech` carries an explicit
     * `@property-read User $user` because `speeches.user_id` is
     * schema-verified `NOT NULL`, and — the part that matters here —
     * `User` deliberately OMITS the `SoftDeletes` trait. Its `deleted_at`
     * is "a moderation grace stamp that every query must filter on
     * explicitly" (the model's own cast docblock), so unlike `Speech` a
     * `User` row is never hidden from this relation by a global scope,
     * and the only way for it to be absent is a hard delete the FK would
     * have to take this speech with it.
     *
     * The takedown marker is spelled out rather than left implicit in
     * `deleted_at`: §6.4's whole job is letting a moderator tell what
     * they are looking at, and "someone already actioned this" is the
     * single most decision-changing fact a queue row can carry.
     */
    private static function describeSpeech(Speech $speech): string
    {
        return sprintf(
            'Speech %s by @%s%s',
            $speech->title,
            $speech->user->username,
            $speech->trashed() ? ' (TAKEN DOWN)' : '',
        );
    }

    private static function speechUrl(Speech $speech): string
    {
        return SpeechResource::getUrl('index', ['search' => $speech->title]);
    }

    /**
     * §6.4's detail view — "a detail view/modal with full context".
     *
     * ⚠️ READ THIS BEFORE REPLACING IT WITH A `ViewAction`. The obvious
     * Filament shape is `ViewAction` plus a `ReportResource::infolist()`
     * override, which `ListRecords::getDefaultActionSchemaResolver()`
     * wires together for free. It is NOT used, and §1.2/§8.2 are why: a
     * resource `ViewAction` authorizes through
     * `Resource::getViewAuthorizationResponse()` →
     * `get_authorization_response('view', $report)`, `ReportPolicy` has
     * no `view` method, so that call falls into the framework's "policy
     * exists, method does not" branch, consults `Gate::before`, and — for
     * a non-admin, where `Gate::before` answers **null** — returns
     * `Response::allow()`. §1.2 states exactly that ("framework fallback
     * is `Response::allow()`") and §8.2's instruction is to override
     * access explicitly, never to lean on policies, for this reason. A
     * `ViewAction` here would be an admin-only surface that is not
     * actually admin-only.
     *
     * So the gate is an honest `hasAnyRole(Role::ADMIN_TIER)` abort,
     * identical in shape and rationale to
     * `SpeechResource::adminActor()`. It is **not** a
     * `Gate::authorize('report.view', ...)`: §5.7's standing rule is that
     * `Gate::before` state 3 is allow-by-default for admins on any
     * UNREGISTERED ability string (`AuthorizationScaffoldTest.php:24`
     * pins `allows('some.arbitrary.ability') === true`), so inventing one
     * here without the matching `Gate::define` plus `$mustFallThrough`
     * entry would be a Gate call that authorizes nothing — the same trap
     * `PanelModerationTest.php:609-614` documents for the deliberately
     * absent `report.dismiss`. `report.resolve` is not borrowed either:
     * it is the WRITE ability for this model, and reusing it to gate a
     * read would make the two impossible to separate later.
     *
     * The gate lives inside the schema closure, not in `->visible()`, for
     * the reason `SpeechResource::playableVideo()` documents at length:
     * `InteractsWithActions::mountAction()` checks `isDisabled()` and
     * never `isVisible()`, and it honours an action's authorization
     * response only when `hasAuthorizationNotification()` is set — so
     * `visible()` removes the button without refusing the call. A schema
     * closure is evaluated during `mountAction()` itself (through
     * `mountedActionHasSchema()`), which is what makes this abort
     * unavoidable rather than decorative.
     *
     * No state gate at all, deliberately: an ALREADY-RESOLVED report is
     * the one a moderator most needs to re-read, because that is what an
     * appeal looks like, and the resolution entries below exist only for
     * that case.
     *
     * Infolist entries, not Blade. §8.3: none of the 15 Tailwind utility
     * classes the panel's two original modals used exists as a selector
     * in the compiled Filament theme, and `api/` ships no built CSS — so
     * both of those modals rendered fully unstyled. Entries inside
     * `Section`s are Filament's own vocabulary, so this surface needs no
     * view file and cannot repeat that mistake.
     *
     * @return array<int, Section>
     */
    private static function contextEntries(): array
    {
        $actor = auth()->user();
        abort_if($actor === null, 403);
        abort_unless($actor->hasAnyRole(Role::ADMIN_TIER), 403);

        return [
            Section::make('Report')
                ->columns(2)
                ->schema([
                    // §6.4's reporter, the second of its four additions.
                    // Nullable by design (`ON DELETE SET NULL`), so the
                    // placeholder has to distinguish "erased account"
                    // from "anonymous report" — a thing this system does
                    // not have.
                    TextEntry::make('reporter.username')
                        ->label('Reported by')
                        ->placeholder('account no longer exists'),
                    TextEntry::make('created_at')
                        ->label('Reported at')
                        ->state(fn (Report $record) => $record->created_at?->toDayDateTimeString())
                        ->placeholder('unknown'),
                    TextEntry::make('reason')->badge(),
                    TextEntry::make('state')->badge(),
                    // §6.4's "single most useful field", unabridged. The
                    // queue column truncates it; this does not.
                    TextEntry::make('detail')
                        ->label('What the reporter wrote')
                        ->placeholder('No detail was given.')
                        ->columnSpanFull(),
                ]),
            Section::make('Reported record')
                ->columns(2)
                ->schema([
                    TextEntry::make('reportable_summary')
                        ->label('Record')
                        ->state(fn (Report $record) => self::reportableContext($record)['summary'])
                        ->url(fn (Report $record) => self::reportableContext($record)['url'])
                        ->openUrlInNewTab()
                        ->helperText('Opens the Speeches table, where the transcript, video and reviewer commentary are readable.')
                        ->columnSpanFull(),
                    TextEntry::make('reportable_type')
                        ->label('Type')
                        ->state(fn (Report $record) => class_basename($record->reportable_type)),
                    TextEntry::make('reportable_id')->label('Record id'),
                ]),
            // Written by `resolve`/`dismiss` since STEP-12 and read back
            // nowhere until now: `resolved_by_id`, `resolved_at` and
            // `resolution_note` had zero readers in the panel, so the
            // queue could not answer "who closed this, when, and why" —
            // the exact question §5.7's audit rows exist to make
            // answerable, asked of the record itself.
            Section::make('Resolution')
                ->columns(2)
                ->schema([
                    TextEntry::make('resolvedBy.username')
                        ->label('Resolved by')
                        ->placeholder('still open'),
                    TextEntry::make('resolved_at')
                        ->label('Resolved at')
                        ->state(fn (Report $record) => $record->resolved_at?->toDayDateTimeString())
                        ->placeholder('still open'),
                    TextEntry::make('resolution_note')
                        ->label('Resolution note')
                        ->placeholder('none recorded')
                        ->columnSpanFull(),
                ]),
        ];
    }

    public static function form(Schema $schema): Schema
    {
        return $schema->components([]);
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
            // Oldest-first is this queue's contract, and
            // `reports_state_created_at_index` is the index that serves
            // it alongside the state filter below. `reporter` is
            // eager-loaded for the column; `reportable` deliberately is
            // not — see `reportableContext()` for why a morphTo eager
            // load would reintroduce the trashed-speech bug.
            ->modifyQueryUsing(fn ($query) => $query->orderBy('created_at')->with('reporter'))
            ->columns([
                // §6.4's deep link, and the answer to "which record was
                // reported". `->url()` is null for a hard-deleted or
                // unrecognised target, which Filament renders as plain
                // text — the tombstone stays legible, it just is not
                // clickable, because there is nothing left to click
                // through to.
                TextColumn::make('reportable_summary')
                    ->label('Reported record')
                    ->state(fn (Report $record) => self::reportableContext($record)['summary'])
                    ->url(fn (Report $record) => self::reportableContext($record)['url'])
                    ->openUrlInNewTab()
                    ->wrap(),
                // This column used to be the whole of the table's answer
                // to "what is this report about", rendered as the raw
                // FQCN `App\Models\Speech`. Kept — the Speech/Review
                // split is still worth a glance — but reduced to its
                // basename now that the column above carries the
                // identity.
                TextColumn::make('reportable_type')
                    ->label('Type')
                    ->formatStateUsing(fn (string $state) => class_basename($state)),
                TextColumn::make('reporter.username')
                    ->label('Reporter')
                    ->placeholder('account erased'),
                TextColumn::make('reason')->badge(),
                // §6.4's "single most useful field" in the queue itself,
                // not only behind the modal — triage happens in this
                // list. Truncated because `detail` is a `VARCHAR(500)` of
                // free text that would push every other column off a
                // laptop screen; the tooltip and the context modal both
                // carry it in full.
                TextColumn::make('detail')
                    ->label('Detail')
                    ->placeholder('none given')
                    ->limit(60)
                    ->tooltip(fn (Report $record) => $record->detail)
                    ->wrap(),
                TextColumn::make('state')->badge(),
                TextColumn::make('created_at')->dateTime()->sortable(),
            ])
            ->filters([
                SelectFilter::make('state')->options(['open' => 'Open', 'actioned' => 'Actioned', 'dismissed' => 'Dismissed']),
            ])
            ->recordActions([
                // §6.4's detail view. Read `contextEntries()`'s docblock
                // before touching this — in particular why it is not a
                // `ViewAction` and why the authorization lives in the
                // schema closure rather than in `visible()`.
                Action::make('viewContext')
                    ->label('View context')
                    ->modalHeading('Report context')
                    ->modalWidth(Width::TwoExtraLarge)
                    ->modalSubmitAction(false)
                    // `schema()`, not `infolist()`: Filament v4 unified
                    // forms and infolists onto one Schema, and
                    // `Action::infolist()` is now a `@deprecated` alias
                    // that forwards straight to this method. The
                    // components it receives are still infolist entries —
                    // see `contextEntries()`.
                    ->schema(fn () => self::contextEntries()),
                Action::make('resolve')
                    ->visible(fn (Report $record) => $record->state === 'open')
                    ->requiresConfirmation()
                    ->schema([Textarea::make('resolution_note')->label('Resolution note')->maxLength(1000)])
                    ->action(function (Report $record, array $data) {
                        $actor = auth()->user();
                        // Gated by EnsureUserIsAdmin before any
                        // /control-panel route (including this action) is
                        // reachable at all — same "auth guaranteed
                        // non-null" guarantee as Controller::currentUser(),
                        // just enforced by a different middleware.
                        abort_if($actor === null, 403);

                        try {
                            // §5.4: `report.resolve` gates BOTH verbs
                            // below. One ability rather than a
                            // resolve/dismiss pair because the thing being
                            // authorized is identical — the power to take a
                            // report out of the queue — and the two
                            // outcomes differ only in what gets recorded.
                            // Splitting them would imply a tier that could
                            // dismiss but not action, which §4's matrix
                            // does not define.
                            Gate::authorize('report.resolve', $record);

                            $record->update([
                                'state' => 'actioned',
                                'resolved_by_id' => $actor->id,
                                'resolved_at' => now(),
                                'resolution_note' => $data['resolution_note'] ?? null,
                            ]);

                            // The `reportable` morph pair is carried into
                            // the metadata on purpose: `audit_log` has no
                            // FK to `reports` and §6.4 notes an admin
                            // cannot currently tell which record a report
                            // names, so a row recording only the report id
                            // would be a trail that needs the (mutable)
                            // report to interpret it. The audit row has to
                            // survive the thing it recorded.
                            AuditLog::query()->create([
                                'actor_id' => $actor->id,
                                'action' => AuditAction::REPORT_RESOLVED,
                                'subject_type' => Report::class,
                                'subject_id' => $record->id,
                                'metadata' => [
                                    'reportable_type' => $record->reportable_type,
                                    'reportable_id' => $record->reportable_id,
                                    'reason' => $record->reason,
                                    'resolution_note' => $data['resolution_note'] ?? null,
                                ],
                                'created_at' => now(),
                            ]);

                            Notification::make()->success()->title('Report resolved.')->send();
                        } catch (AuthorizationException $e) {
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
                    }),
                Action::make('dismiss')
                    ->visible(fn (Report $record) => $record->state === 'open')
                    ->requiresConfirmation()
                    ->action(function (Report $record) {
                        $actor = auth()->user();
                        abort_if($actor === null, 403);

                        try {
                            Gate::authorize('report.resolve', $record);

                            $record->update([
                                'state' => 'dismissed',
                                'resolved_by_id' => $actor->id,
                                'resolved_at' => now(),
                            ]);

                            // No reason field on `dismiss`, deliberately.
                            // §5.5's required reason is about adverse
                            // decisions taken AGAINST a user, who is owed a
                            // statement of them; a dismissal is a decision
                            // about the reporter's request and takes no
                            // action against anyone, so there is nobody to
                            // notify and nothing to justify to them. The
                            // audit row is still mandatory — that is the
                            // §5.7 half, and it is what makes "this queue
                            // was emptied without action" reviewable later.
                            AuditLog::query()->create([
                                'actor_id' => $actor->id,
                                'action' => AuditAction::REPORT_DISMISSED,
                                'subject_type' => Report::class,
                                'subject_id' => $record->id,
                                'metadata' => [
                                    'reportable_type' => $record->reportable_type,
                                    'reportable_id' => $record->reportable_id,
                                    'reason' => $record->reason,
                                ],
                                'created_at' => now(),
                            ]);

                            // Was silent. `resolve` has always sent a
                            // success Notification and `dismiss` sent
                            // nothing, so a dismissal looked like a
                            // no-op click until the row re-rendered.
                            Notification::make()->success()->title('Report dismissed.')->send();
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
            'index' => ManageReports::route('/'),
        ];
    }
}
