<?php

namespace App\Filament\Resources\UserResource\Pages;

use App\Filament\Resources\UserResource;
use App\Models\AuditLog;
use App\Models\Connection;
use App\Models\Review;
use App\Models\User;
use App\Support\AuditAction;
use App\Support\Role;
use Filament\Infolists\Components\RepeatableEntry;
use Filament\Infolists\Components\RepeatableEntry\TableColumn;
use Filament\Infolists\Components\TextEntry;
use Filament\Resources\Pages\ViewRecord;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;

/**
 * PLAN-ADMIN-DASHBOARD.md §6.2's user detail page, in the plan's own words:
 * "a user detail page (speeches, reviews, connections, storage vs quota)".
 * Role badges and the suspension/deletion history are the two additions
 * §6.2 implies elsewhere and does not list in that clause — see
 * `moderationHistory()` below for why the history half is not optional.
 *
 * ## Why this page exists at all
 *
 * The table in `UserResource` answers "which users" and nothing about any
 * one of them. Every number on this page was already in the schema and
 * readable from nowhere:
 *
 *  - `storage_bytes_used` / `quota_bytes` / `uploads_in_flight` have
 *    existed since `2026_08_08_150001` with no reader anywhere in `app/`
 *    outside `QuotaService`'s own conditional UPDATEs — not in this panel,
 *    not in the SPA. "Why can this user not upload" was unanswerable
 *    without a psql prompt.
 *  - Suspension/deletion ATTRIBUTION has no column to read. §6.2 settles
 *    this explicitly rather than leaving it open: "`users.suspended_by_id`
 *    does not exist — specified at `MODERNIZATION_PLAN.md:600`, deferred
 *    STEP-11 → STEP-12, never built. **Recommend: skip the column, read
 *    `audit_log`** (decided, not an open question)." So the history
 *    section is a query against `audit_log`, and that is the design, not a
 *    workaround for a missing join.
 *
 * ## An infolist, not a Blade view — §8.3
 *
 * §8.3's constraint is real and narrow: none of the Tailwind utility
 * classes used by this repo's existing modals exists as a selector in the
 * compiled Filament theme, and `api/` ships no built CSS (`package.json`
 * declares a Tailwind toolchain, but there is no `node_modules`, no
 * `public/build`, and the Dockerfile's `webbuild` stage builds `web/`
 * only). Two sibling modals shipped with exactly those classes and
 * rendered as unstyled divs.
 *
 * `resources/views/filament/speech-transcript.blade.php` answers that with
 * `x-filament::section` / `badge` / `empty-state`, and that is the right
 * answer for a page whose body is free-form text. This page has no
 * free-form body — it is labelled scalars plus one table — so it goes one
 * step further and uses no Blade of its own at all. `Section`,
 * `TextEntry`, `RepeatableEntry` are Filament's own components, already
 * compiled into the shipped theme, so there is no CSS for §8.3 to be a
 * constraint on.
 *
 * ## ⚠️ `User` has no `SoftDeletes` trait
 *
 * `deleted_at` is a plain column here (the migration's own docblock says
 * so, and `User`'s `casts()` repeats it), so NOTHING filters it out
 * globally. Two consequences visible on this page:
 *
 *  - Resolving `{record}` finds soft-deleted users, which is exactly what
 *    a moderator reviewing an appeal needs — the same reasoning §6.3 gives
 *    for querying speeches `withTrashed()`.
 *  - Any count of OTHER users would need `whereNull('deleted_at')` by
 *    hand. None of the counts below cross into `users`, so none needs it;
 *    `Speech`, by contrast, DOES use `SoftDeletes`, which is why the
 *    speech counts below are deliberately split into live and trashed.
 */
class ViewUser extends ViewRecord
{
    protected static string $resource = UserResource::class;

    /**
     * §8.2: "**Page** → `canAccess()`, defaults `true`." Both halves of
     * that section's requirement — "enforced on `mount` **and**
     * `hydrate`" — come from this one method, because
     * `Filament\Pages\Concerns\CanAuthorizeAccess` (used by
     * `Filament\Pages\Page`, which this class inherits through
     * `Resources\Pages\Page`) declares `mountCanAuthorizeAccess()` AND
     * `hydrateCanAuthorizeAccess()`, and both are
     * `abort_unless(static::canAccess(), 403)`.
     *
     * The hydrate half is the one that matters and the one that is easy to
     * believe is redundant. `POST livewire/update` runs the `web`
     * middleware group alone, and `AdminPanelProvider` declares its own
     * middleware array and never uses `web` — so `EnsureUserIsAdmin` is
     * NOT in the stack for a Livewire round trip, and a page guarded only
     * at mount stays directly addressable afterwards.
     *
     * This is belt-and-braces with `UserResource::
     * getViewAuthorizationResponse()` (which `ViewRecord::
     * authorizeAccess()` consults from `mount`) and deliberately so: that
     * one is per-RECORD, this one is per-PAGE, and the vendor runs them at
     * different points in the lifecycle. §8.2 asks for both.
     *
     * @param  array<string, mixed>  $parameters
     */
    public static function canAccess(array $parameters = []): bool
    {
        $actor = auth()->user();

        return $actor !== null && $actor->hasAnyRole(Role::ADMIN_TIER);
    }

    /**
     * Overridden on the PAGE rather than on `UserResource`, even though
     * `ViewRecord::infolist()` delegates to the resource by default. §6.2
     * calls this "a user detail page", and keeping its whole definition
     * under `UserResource/Pages/` means the resource file stays what it is
     * — a table plus moderation actions — instead of growing a second,
     * unrelated 150-line schema.
     *
     * ⚠️ `hasInfolist()` is `(bool) count($this->getSchema('infolist')->
     * getComponents())`. If this method ever returns `$schema` unchanged,
     * `ViewRecord::mount()` silently falls back to `fillForm()` against
     * `UserResource::form()`, which is `$schema->components([])` — an
     * EMPTY page, rendered with no error. That failure mode is why the
     * sections below are unconditional: a section whose own visibility
     * closure could hide every component would reintroduce it.
     */
    public function infolist(Schema $schema): Schema
    {
        return $schema->components([
            $this->identitySection(),
            $this->storageSection(),
            $this->activitySection(),
            $this->moderationHistorySection(),
        ]);
    }

    /**
     * Identity and lifecycle state, including §6.2's "role badges".
     *
     * ⚠️ All THREE terminal states are shown, not the two §6.2 names.
     * `App\Http\Middleware\CheckUserIsActive` refuses access on
     * `suspended_at`, `deleted_at` AND `anonymized_at`, so a page that
     * displayed only the first two could show an account as apparently
     * fine while the middleware locks it out — and `anonymized_at` is the
     * one of the three that is IRREVERSIBLE (`AccountErasureService` has
     * already deleted the bytes), which makes it the most expensive one to
     * leave off a moderator's screen. `UserResource`'s `lifecycle` filter
     * takes the same position for the same reason.
     */
    private function identitySection(): Section
    {
        return Section::make('Account')
            ->schema([
                TextEntry::make('id')->label('ID'),
                TextEntry::make('username'),
                TextEntry::make('email')->copyable(),
                // The badge form of §6.2's "role columns", via the Spatie
                // relation rather than `getRoleNames()`, so the entry
                // resolves its own state from the record like every other
                // entry here. `placeholder` covers the real case of a user
                // with no role row at all — `RoleSeeder` creates the roles
                // but nothing forces an account to hold one.
                TextEntry::make('roles.name')
                    ->label('Roles')
                    ->badge()
                    ->placeholder('No roles'),
                TextEntry::make('created_at')->label('Joined')->dateTime(),
                TextEntry::make('suspended_at')
                    ->label('Suspended')
                    ->dateTime()
                    ->badge()
                    ->color('warning')
                    ->placeholder('Not suspended'),
                TextEntry::make('deleted_at')
                    ->label('Deleted')
                    ->dateTime()
                    ->badge()
                    ->color('danger')
                    ->placeholder('Not deleted'),
                TextEntry::make('anonymized_at')
                    ->label('Anonymized')
                    ->dateTime()
                    ->badge()
                    ->color('danger')
                    ->placeholder('Not anonymized'),
            ]);
    }

    /**
     * §6.2's "storage vs quota".
     *
     * Formatted through `UserResource::formatBytes()` — the same formatter
     * the table column uses, for the reason that method's own docblock
     * gives at length: `Illuminate\Support\Number::fileSize()` throws
     * `RuntimeException` without `ext-intl`, which is present in the
     * production image and absent on a dev host, so it is a formatter that
     * works in prod and crashes locally. Sharing the one function also
     * means the detail page and the table can never disagree about what
     * "4.9 GiB" means.
     *
     * `uploads_in_flight` gets its own entry because it is the half of the
     * quota that goes WRONG rather than the half that fills up:
     * `QuotaService` admits at most 2 concurrent uploads, and
     * `MediaReconcileCommand`'s docblock records that without its sweep
     * "`uploads_in_flight` never comes back down" — a user pinned at 2
     * cannot upload anything, and nothing in the product tells anyone why.
     */
    private function storageSection(): Section
    {
        return Section::make('Storage')
            ->schema([
                TextEntry::make('storage_bytes_used')
                    ->label('Used')
                    ->getStateUsing(fn (User $record): string => UserResource::formatBytes((int) $record->storage_bytes_used)),
                TextEntry::make('quota_bytes')
                    ->label('Quota')
                    ->getStateUsing(fn (User $record): string => UserResource::formatBytes((int) $record->quota_bytes)),
                // Rendered from the same two integers rather than stored:
                // `QuotaService` is the only writer, and a cached ratio
                // could disagree with its own inputs. The `> 0` guard is
                // not defensive padding — `quota_bytes` is nullable at the
                // schema level, so a zero/null quota is a division by zero
                // on a real row.
                TextEntry::make('quota_share')
                    ->label('Share of quota')
                    ->badge()
                    ->getStateUsing(function (User $record): string {
                        $quota = (int) $record->quota_bytes;

                        if ($quota <= 0) {
                            return 'No quota set';
                        }

                        return number_format((int) $record->storage_bytes_used / $quota * 100, 1).'%';
                    })
                    ->color(fn (User $record): string => ((int) $record->quota_bytes) > 0
                        && (int) $record->storage_bytes_used >= (int) $record->quota_bytes * 0.9
                            ? 'danger'
                            : 'gray'),
                TextEntry::make('uploads_in_flight')
                    ->label('Uploads in flight')
                    ->badge()
                    ->color(fn (User $record): string => ((int) $record->uploads_in_flight) > 0 ? 'warning' : 'gray'),
            ]);
    }

    /**
     * §6.2's "speeches, reviews, connections".
     *
     * Counts rather than three embedded tables. Three relation managers
     * would each be a Livewire component with its own authorization
     * surface to get right (§8.2), and the question this page answers is
     * "how much of this platform is this account", not "show me their
     * work" — `SpeechResource` already owns the latter and is filterable
     * by user. §10's whole argument is that v1 is the non-negotiable list.
     *
     * ⚠️ Three model-specific soft-delete rules collide in this one
     * section, and getting any of them wrong silently understates the
     * answer:
     *
     *  - `Speech` DOES use `SoftDeletes`, so `$record->speeches()` already
     *    excludes taken-down speeches. That is a real distinction for a
     *    moderator — "has 40 speeches" and "has 4 speeches and 36
     *    takedowns" are different accounts — so both are shown, the second
     *    via `onlyTrashed()`.
     *  - `reviews` has NO soft-delete state at all (its migration says so
     *    outright: "there is no soft-delete state for this table" —
     *    withdrawal is `revoked_at` in place, abandonment is a status).
     *    So the count is a plain count, and `Review::ACCESS_GRANTING` is
     *    used for the "live" subset rather than a hand-typed status list,
     *    since that constant is what `Speech::scopeVisibleTo` and the
     *    policies already agree on.
     *  - `connections` is MIRRORED — a pair is two rows — so counting
     *    `owner_id = :user AND state = 'accepted'` is this user's own
     *    connection list exactly once, with no double counting.
     *    `MostConnectionsWidget` counts the same column deliberately
     *    double for an abuse signal; this is the per-user view, where the
     *    honest number is the one the user would see.
     */
    private function activitySection(): Section
    {
        return Section::make('Activity')
            ->schema([
                TextEntry::make('speech_count')
                    ->label('Speeches')
                    ->getStateUsing(fn (User $record): int => $record->speeches()->count()),
                TextEntry::make('taken_down_speech_count')
                    ->label('Taken down')
                    ->badge()
                    ->getStateUsing(fn (User $record): int => $record->speeches()->onlyTrashed()->count())
                    // `$state` (the value `getStateUsing()` just produced),
                    // not a second `onlyTrashed()->count()`: the colour
                    // closure runs per render too, so repeating the query
                    // doubled this entry's cost to say the same thing —
                    // and left two places that could disagree about
                    // whether the badge is red.
                    ->color(fn ($state): string => ((int) $state) > 0 ? 'danger' : 'gray'),
                TextEntry::make('review_count')
                    ->label('Reviews given')
                    ->getStateUsing(fn (User $record): int => Review::query()->where('reviewer_id', $record->id)->count()),
                TextEntry::make('granting_review_count')
                    ->label('Reviews granting access')
                    ->getStateUsing(fn (User $record): int => Review::query()
                        ->where('reviewer_id', $record->id)
                        ->whereIn('status', Review::ACCESS_GRANTING)
                        ->count()),
                TextEntry::make('reviews_received_count')
                    ->label('Reviews received')
                    ->getStateUsing(fn (User $record): int => Review::query()->where('speech_owner_id', $record->id)->count()),
                TextEntry::make('connection_count')
                    ->label('Connections')
                    ->getStateUsing(fn (User $record): int => Connection::query()
                        ->where('owner_id', $record->id)
                        ->where('state', 'accepted')
                        ->count()),
                TextEntry::make('pending_connection_count')
                    ->label('Pending connections')
                    ->getStateUsing(fn (User $record): int => Connection::query()
                        ->where('owner_id', $record->id)
                        ->where('state', 'pending')
                        ->count()),
            ]);
    }

    /**
     * §6.2's suspension/deletion history, and the section that makes this
     * page more than a stat sheet.
     *
     * This is the decided answer to §6.2's one deferred schema question:
     * "`users.suspended_by_id` does not exist... **Recommend: skip the
     * column, read `audit_log`** (decided, not an open question)." So
     * attribution — WHO suspended this account, and WHY — is sourced
     * entirely from `audit_log` rows, joined to their actor.
     *
     * Reading it is only possible because `UserResource`'s moderation
     * actions write it. Before §5.5/§5.7 those rows carried
     * `'metadata' => []`, and `AuditAction::USER_DELETED`/`USER_RESTORED`
     * had NO call site at all — so this section would have rendered an
     * empty table for a suspended user and no row whatsoever for a deleted
     * one. The reason column is the whole point of an audit row for a
     * moderation verb, and it is the column a moderator reviewing an
     * appeal reads first.
     *
     * ⚠️ `audit_log` is append-only by design (`AuditLog`'s docblock:
     * `public $timestamps = false`, and no update/delete path anywhere) and
     * its `action` column is deliberately FREE TEXT at the DB level — an
     * open vocabulary. So this filters on an explicit `whereIn` of the six
     * `AuditAction` constants that are lifecycle verbs on a `User`
     * subject. It must NOT be a blanket "every row about this user":
     * `ADMIN_VIEWED_SPEECH`/`ADMIN_VIEWED_DOCUMENT`/
     * `ADMIN_VIEWED_COMMENTARY` and the account-export verbs also carry
     * `subject_type = User::class`, and folding an admin's read-audit into
     * a moderation history would bury four suspensions under four hundred
     * page views.
     *
     * Role grants ARE included. A demotion is a moderation decision in
     * everything but name — §4 holds `admin`/`super_admin` grants one tier
     * above suspension precisely because they are more consequential — and
     * `RoleAssignmentService::audit()` records the role in `metadata`, so
     * the rows are self-describing.
     *
     * `limit(50)` with no pagination: this is a summary, `audit_log` is the
     * append-only record of last resort, and a moderator who needs the
     * 51st row needs the table, not this page. `with('actor')` because the
     * actor name is read once per row — without it this is 50 queries.
     * `whereNull('actor_id')` is not filtered out: a system-originated row
     * (nullable `actor_id`) is a legitimate entry and renders as the
     * placeholder.
     *
     * ⚠️ `created_at DESC, id DESC` — not `created_at` alone. Every writer
     * in this codebase passes `'created_at' => now()`, so a bulk
     * suspension of 25 users writes 25 rows with the IDENTICAL timestamp,
     * and a single-column sort over ties is not deterministic. The id
     * tiebreak is what keeps two renders of the same history in the same
     * order.
     */
    private function moderationHistorySection(): Section
    {
        return Section::make('Suspension and deletion history')
            ->description('Sourced from audit_log — there is no suspended_by_id column, by decision (§6.2).')
            ->schema([
                RepeatableEntry::make('moderation_history')
                    ->hiddenLabel()
                    ->placeholder('No moderation actions have ever been taken against this account.')
                    ->getStateUsing(fn (User $record): array => $this->moderationHistory($record))
                    // `->table(...)` renders the repeatable as a real table
                    // with these headers instead of a stack of labelled
                    // cards. Four columns of three-word values is a table;
                    // 50 cards is a scroll.
                    ->table([
                        TableColumn::make('When'),
                        TableColumn::make('Action'),
                        TableColumn::make('By'),
                        TableColumn::make('Reason'),
                    ])
                    ->schema([
                        TextEntry::make('when')->hiddenLabel(),
                        TextEntry::make('action')->hiddenLabel()->badge(),
                        TextEntry::make('actor')->hiddenLabel(),
                        TextEntry::make('reason')->hiddenLabel(),
                    ]),
            ]);
    }

    /**
     * The `audit_log` read behind the section above, kept as its own method
     * so the query is testable and readable without the schema noise around
     * it.
     *
     * Returns a list of flat string maps rather than models:
     * `RepeatableEntry::getDefaultChildSchemas()` calls `constantState()`
     * for an array item and `record()` for a `Model`, and the array branch
     * is the one that lets `actor` and `reason` be derived values
     * (the actor's username, `$row->metadata['reason']`) instead of
     * raw columns. Pre-flattening here also means the four `TextEntry`
     * children above need no closures at all.
     *
     * `metadata` is cast to `array` on the model, so the `??` fallbacks are
     * not paranoia about the cast — they cover the genuinely older rows
     * written before §5.5 made the reason mandatory, which carry
     * `metadata => []`.
     *
     * @return list<array<string, string>>
     */
    private function moderationHistory(User $record): array
    {
        $rows = AuditLog::query()
            ->with('actor')
            ->where('subject_type', User::class)
            ->where('subject_id', $record->id)
            ->whereIn('action', [
                AuditAction::USER_SUSPENDED,
                AuditAction::USER_UNSUSPENDED,
                AuditAction::USER_DELETED,
                AuditAction::USER_RESTORED,
                AuditAction::ROLE_ASSIGNED,
                AuditAction::ROLE_REVOKED,
            ])
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(50)
            ->get();

        // A `foreach` with `[] =` rather than `->map(...)->all()`.
        // `Collection::map()` PRESERVES keys, so `all()` returns
        // `array<int, …>` and not a `list<…>` — and `->values()->all()` on
        // an Eloquent collection does not recover the list type either.
        // Appending is what actually produces a list, which is what this
        // method's return type promises and what `RepeatableEntry` iterates.
        $history = [];

        foreach ($rows as $row) {
            $metadata = $row->metadata;

            $reason = $metadata['reason'] ?? null;
            $role = $metadata['role'] ?? null;

            // `data_get`, not `$row->actor->username`. `audit_log.actor_id`
            // is NULLABLE — the column is there so a system-originated row
            // can exist without inventing a user to blame — so the relation
            // is genuinely null for such a row and a direct property read
            // would be a fatal on exactly the rows this page is meant to
            // survive. Every writer in `app/` passes a real `actor_id`
            // today, which is the only reason this has never been hit.
            $actorName = data_get($row, 'actor.username');

            $history[] = [
                'when' => $row->created_at->toDateTimeString(),
                // The role is appended to the action rather than given a
                // column of its own: it is populated for exactly two of the
                // six actions, and a column that is empty on two thirds of
                // the rows costs more than it tells.
                'action' => is_string($role) ? $row->action.' ('.$role.')' : $row->action,
                // ⚠️ Three cases, not two, because `users.username` is
                // ALSO nullable: `UserFactory` defaults it to null and the
                // column is only populated during onboarding, so an
                // administrator with no username is a real row. Collapsing
                // "no actor" and "actor with no username" into one
                // `'system'` fallback would attribute a human's moderation
                // decision to the platform — the single worst thing an
                // attribution column can do, and the reason this is not
                // just `?? 'system'`.
                'actor' => is_string($actorName) && $actorName !== ''
                    ? $actorName
                    : ($row->actor_id === null ? 'system' : 'user #'.$row->actor_id),
                'reason' => is_string($reason) ? $reason : '—',
            ];
        }

        return $history;
    }
}
