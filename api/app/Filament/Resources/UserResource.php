<?php

namespace App\Filament\Resources;

use App\Exceptions\LastAdministratorException;
use App\Filament\Resources\UserResource\Pages\ManageUsers;
use App\Filament\Resources\UserResource\Pages\ViewUser;
use App\Models\AuditLog;
use App\Models\User;
use App\Notifications\AccountDeleted;
use App\Notifications\AccountSuspended;
use App\Services\RoleAssignmentService;
use App\Services\UserDeletionService;
use App\Support\AuditAction;
use App\Support\Role;
use Filament\Actions\Action;
use Filament\Actions\BulkAction;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\PageRegistration;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\Access\Response;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;

/**
 * STEP-12-admin-portal.md: "user list with a role filter — the legacy app
 * could not filter by role, so 'show me all coaches' was impossible."
 *
 * NON-NEGOTIABLE (STEP-12-FROZEN-CONTRACT.md §11/§3): every action here
 * that changes a role or suspends/deletes a user calls
 * `RoleAssignmentService`/`UserDeletionService` — never `assignRole()`/
 * `delete()` directly, including inside a BULK action, per §7.4's own
 * warning that bulk actions bypass policies.
 *
 * Every action below now also calls `Gate::authorize(...)` before writing
 * — found missing entirely by `/code-review` (two independent finder
 * angles): none of these closures called the Gate at all, so
 * `UserPolicy::suspend()`'s self-exclusion was dead code reachable only
 * by direct `Gate::forUser()` tests, and an admin could suspend
 * themselves through this exact UI. `AuthorizationException` is caught
 * the same way `LastAdministratorException` already was, so a denial
 * shows a Notification instead of Filament's raw 403 page.
 *
 * PLAN-ADMIN-DASHBOARD.md §5.4 then found that fix to be HALF applied —
 * see `toggleSuspend`, hole 1 of the plan's eight: the Gate landed in the
 * `else`, so the unsuspend branch routed around it. §5.5 adds the
 * mandatory moderation reason and the notice to the suspended user.
 *
 * There is deliberately NO "Grant coach" action here. §6.8/user-
 * constraints.md: "Only an Admin can create a Coach, and only after
 * reviewing certification PDFs the user uploaded" — the only legal path
 * to the `coach` role is `CoachApplicationDecisionService::approve()`
 * (`CoachApplicationResource`'s "approve" action). An earlier version of
 * this file had a standalone "Grant coach" button here with no
 * application/document precondition at all, bypassing the entire
 * certification-review requirement — found by `/code-review`'s
 * conventions angle against that exact rule. "Revoke coach" (demotion)
 * stays: §6.8 explicitly treats demotion as a separate, unconditional
 * admin power ("their existing reviews survive... demotion removes
 * reach, not history"), unlike promotion.
 *
 * §6.2 (Phase 2a) then finished the half-built surface this file was.
 * Everything it adds is listed in the plan's own words — "delete /
 * restore row actions · a user detail page · grant/revoke `admin`|
 * `super_admin` (super_admin only, allowlisted) · storage and role
 * columns" — and all of it lands here or in `Pages/ViewUser.php`:
 *
 *  - `softDelete`/`restore` row actions. `UserDeletionService::
 *    softDelete()` had ZERO callers and `AuditAction::USER_DELETED`/
 *    `USER_RESTORED` had zero call sites, which §6.2 calls "the cheapest
 *    real capability in the plan". Both halves ship together on purpose:
 *    §6.2's correction is that `restore()` was "a bare forceFill with no
 *    self-check and no roster lock — it is NOT guarded", so a Delete
 *    button alone would have been a one-way door. The guards landed in
 *    the same change (see that method's docblock).
 *  - `grantAdminRole`/`revokeAdminRole`, the only super_admin-ONLY
 *    actions in this panel (§4's "Grant / revoke `admin`,
 *    `super_admin`" row). §8.2 is the rule they follow: an explicit
 *    `->visible()` AND a real `Gate::authorize` inside the closure,
 *    because visibility alone is cosmetic.
 *  - A storage column and a lifecycle filter. `storage_bytes_used`,
 *    `quota_bytes` and `uploads_in_flight` have existed since
 *    2026_08_08_150001 and were surfaced NOWHERE — not in this panel,
 *    not in the SPA — so "why can this user not upload" was
 *    unanswerable without a psql prompt.
 *  - `ViewAction`, pointing at `Pages\ViewUser` (§6.2's detail page).
 *
 * ⚠️ The "no Grant coach button" rule above survives §6.2 intact, and
 * `grantAdminRole` is where a future change is most likely to break it by
 * accident: it hands `RoleAssignmentService::assign()` a role name taken
 * from the submitted form, and that service's allowlist accepts `coach`
 * (it must — `CoachApplicationDecisionService::approve()` depends on it).
 * The `in_array(..., Role::SUPER_ADMIN_ONLY_GRANTS, true)` check inside
 * that closure is therefore the ONLY thing standing between a tampered
 * Livewire payload and the certification-review bypass §0/Q0 forbids. It
 * is not belt-and-braces with the Select's own options; it is the
 * enforcement.
 */
class UserResource extends Resource
{
    protected static ?string $model = User::class;

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

    protected static \BackedEnum|string|null $navigationIcon = 'heroicon-o-users';

    protected static ?int $navigationSort = 2;

    protected static ?string $navigationLabel = 'Users';

    public static function form(Schema $schema): Schema
    {
        return $schema->components([]);
    }

    /**
     * §6.2's storage column, and the reason it is hand-rolled.
     *
     * `Illuminate\Support\Number::fileSize()` is the obvious call and it
     * CANNOT be used here: it delegates to `Number::format()`, which calls
     * `ensureIntlExtensionIsInstalled()` and throws `RuntimeException`
     * without `ext-intl`. `filament/support` declares `ext-intl` in its
     * own `require` while this repo installs with
     * `--ignore-platform-req=ext-intl` (Dockerfile:39/307), so the
     * extension is present in the production image and absent on a dev
     * host — a formatter that works in prod and throws locally is the
     * worst of both, and `PanelModerationTest`'s own harness docblock
     * records how an entire test file once errored on exactly this.
     * `number_format()` is PHP core and needs no extension.
     *
     * Binary units (1024), matching `quota_bytes`' own default of
     * `5 * 1024 * 1024 * 1024` — the quota is expressed in GiB, so
     * rendering the usage in GB would make a full quota read as "5.4 GB
     * of 5.0 GB".
     */
    public static function formatBytes(int $bytes): string
    {
        $units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

        $power = $bytes > 0
            ? min((int) floor(log($bytes, 1024)), count($units) - 1)
            : 0;

        $value = $bytes / (1024 ** $power);

        return number_format($value, $power === 0 ? 0 : 1).' '.$units[$power];
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
            ->columns([
                TextColumn::make('id')->sortable(),
                TextColumn::make('username')->searchable(),
                TextColumn::make('email')->searchable(),
                TextColumn::make('roles.name')->badge()->label('Roles'),
                // §6.2's "storage and role columns". The role column
                // already existed (`roles.name` above, STEP-12's "show me
                // all coaches"); the storage half did not, and these three
                // columns have been in the schema since
                // 2026_08_08_150001 with no reader anywhere in `app/`
                // outside `QuotaService`'s own conditional UPDATEs.
                //
                // Used and quota are ONE column rather than two because
                // neither number means anything alone: 4.9 GiB is
                // unremarkable against a raised quota and terminal against
                // the 5 GiB default, and the question a moderator actually
                // has ("is this account out of room") is the ratio. The
                // percentage is rendered from the same two integers rather
                // than stored, since `QuotaService` is the only writer and
                // a cached ratio could disagree with its own inputs.
                TextColumn::make('storage_bytes_used')
                    ->label('Storage')
                    ->sortable()
                    ->formatStateUsing(function ($state, User $record): string {
                        $used = (int) $state;
                        $quota = (int) $record->quota_bytes;

                        $share = $quota > 0
                            ? ' · '.number_format($used / $quota * 100, 1).'%'
                            : '';

                        return self::formatBytes($used).' / '.self::formatBytes($quota).$share;
                    }),
                // Surfaced on its own because it is the half of the quota
                // that goes WRONG: `QuotaService` admits at most 2
                // concurrent uploads, the counter is decremented by
                // completion/abort paths, and `MediaReconcileCommand`'s
                // docblock records that without its sweep
                // "`uploads_in_flight` never comes back down" — a user
                // stuck at 2 cannot upload anything and nothing in the
                // product tells anyone why.
                TextColumn::make('uploads_in_flight')
                    ->label('In flight')
                    ->badge()
                    ->color(fn ($state): string => ((int) $state) > 0 ? 'warning' : 'gray')
                    ->sortable(),
                TextColumn::make('suspended_at')->label('Suspended')->dateTime(),
                TextColumn::make('deleted_at')->label('Deleted')->dateTime(),
            ])
            ->filters([
                SelectFilter::make('roles')
                    ->relationship('roles', 'name')
                    ->label('Role')
                    ->options([Role::SUPER_ADMIN => 'Super admin', Role::ADMIN => 'Admin', Role::COACH => 'Coach', Role::MEMBER => 'Member']),
                // §6.2's "filter for suspended / deleted state". The two
                // columns were already DISPLAYED (above) and there was no
                // way to ask the only question they are good for — "who is
                // currently locked out" — short of sorting by a nullable
                // timestamp.
                //
                // ⚠️ `active` tests all THREE terminal states, not the two
                // §6.2 names. `App\Http\Middleware\CheckUserIsActive`
                // refuses access on `suspended_at`, `deleted_at` AND
                // `anonymized_at`, so a filter that called an anonymized
                // account "active" would contradict the middleware that
                // decides it — and `RoleAssignmentService::
                // remainingAdminCountExcluding()` already counts
                // eligibility exactly this way. `anonymized` is offered as
                // its own option for the same reason it is terminal: it is
                // the one state of the three that is irreversible, so
                // confusing it with a suspension is the expensive mistake.
                //
                // Written as `->query()` rather than three columns' worth
                // of `TernaryFilter`s because the states are mutually
                // exclusive in practice and a moderator picks one;
                // `SelectFilter::apply()` hands the whole thing over to
                // this closure as soon as a query modification callback
                // exists, so the `roles`-style relationship behaviour of
                // the filter above does not apply here.
                SelectFilter::make('lifecycle')
                    ->label('State')
                    ->options([
                        'active' => 'Active',
                        'suspended' => 'Suspended',
                        'deleted' => 'Deleted',
                        'anonymized' => 'Anonymized',
                    ])
                    ->query(function (Builder $query, array $data): Builder {
                        /** @var Builder<User> $query */
                        return match ($data['value'] ?? null) {
                            'active' => $query
                                ->whereNull('suspended_at')
                                ->whereNull('deleted_at')
                                ->whereNull('anonymized_at'),
                            'suspended' => $query->whereNotNull('suspended_at'),
                            'deleted' => $query->whereNotNull('deleted_at'),
                            'anonymized' => $query->whereNotNull('anonymized_at'),
                            default => $query,
                        };
                    }),
            ])
            ->recordActions([
                // §6.2's detail page. Deliberately the FIRST record action
                // so the cheap read sits ahead of every write — and it is
                // the only action here that is not a moderation verb.
                //
                // `ViewAction` becomes a LINK rather than a modal purely
                // because `getPages()` below registers a `view` page:
                // `Filament\Resources\Pages\Page::getDefaultActionUrl()`
                // returns the resource's `view` URL when
                // `hasPage('view') && ! $this instanceof ViewRecord`. Drop
                // that registration and this silently degrades into a modal
                // rendering `UserResource::form()`, which is an empty
                // schema — i.e. a blank modal, not an error.
                ViewAction::make(),
                Action::make('revokeCoach')
                    ->label('Revoke coach')
                    ->visible(fn (User $record) => $record->hasRole('coach'))
                    ->requiresConfirmation()
                    ->action(function (User $record) {
                        $actor = auth()->user();
                        // Gated by EnsureUserIsAdmin before any
                        // /control-panel route (including this action) is
                        // reachable at all — same "auth guaranteed
                        // non-null" guarantee as Controller::currentUser(),
                        // just enforced by a different middleware.
                        abort_if($actor === null, 403);

                        try {
                            Gate::authorize('role.revoke', $record);
                            // §5.7: the ROLE_REVOKED write that used to sit
                            // here has moved INTO
                            // `RoleAssignmentService::revoke()`. The plan's
                            // finding was that "audit is the caller's
                            // responsibility and `GrantRoleCommand` writes
                            // none" — a rule no amount of care at this call
                            // site can enforce for the next caller. Writing
                            // it in the service makes the audit row an
                            // invariant of the role change itself, and
                            // keeping a second write here would now produce
                            // two rows for one revocation.
                            app(RoleAssignmentService::class)->revoke($actor, $record, 'coach');
                        } catch (AuthorizationException|LastAdministratorException $e) {
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
                    }),
                Action::make('toggleSuspend')
                    ->label(fn (User $record) => $record->suspended_at ? 'Unsuspend' : 'Suspend')
                    ->requiresConfirmation()
                    // §5.5: required reason on suspend. One schema serves
                    // both branches of the toggle — on a suspension it is
                    // the statement of reasons sent to the user, on a
                    // reinstatement it is the operator's note for the audit
                    // trail. Requiring it in both directions is the simpler
                    // and the safer choice: a conditional `->required()`
                    // closure would make the one field that must never be
                    // skippable depend on reading the record's current
                    // state correctly.
                    ->schema([
                        Textarea::make('reason')
                            ->label('Reason')
                            ->helperText('Recorded in the audit log. On a suspension it is sent to the user verbatim.')
                            ->required()
                            ->maxLength(1000),
                    ])
                    ->action(function (User $record, array $data) {
                        $actor = auth()->user();
                        abort_if($actor === null, 403);
                        $service = app(UserDeletionService::class);

                        try {
                            // §5.4 hole 1. `Gate::authorize('user.suspend',
                            // ...)` used to sit in the `else` ONLY, so the
                            // `if ($record->suspended_at)` path reached
                            // `unsuspend()` completely ungated — an earlier
                            // fix that added the Gate to this action landed
                            // on one of its two branches, which is a worse
                            // state than no Gate at all because the file
                            // then reads as if it were guarded. Hoisted
                            // above the branch so there is no second path
                            // to route around it.
                            //
                            // ⚠️ `user.suspend` is deliberately reused for
                            // BOTH directions, and it is an imperfect fit
                            // in one specific way worth recording rather
                            // than hiding. `UserPolicy::suspend()` is
                            // `canModerate()`: actor is admin-tier, target
                            // is not self, and `! wouldOrphanAdminRoster
                            // ($target)`. That third clause asks "would
                            // REMOVING this user zero the admin roster",
                            // which reads backwards for a restoration —
                            // `UserPolicy::assign()`'s own docblock makes
                            // the same point ("an ADDITION can never reduce
                            // the admin count, so no last-admin check is
                            // needed here"). The practical consequence: if
                            // the last remaining admin is already
                            // suspended, this panel will refuse to
                            // unsuspend them, and the recovery is the
                            // documented break-glass (`php artisan
                            // user:grant-role` to restore the roster
                            // first). Denying is the fail-safe direction,
                            // and the alternative — a dedicated
                            // `user.unsuspend` ability — needs a
                            // `Gate::define` plus a `$mustFallThrough`
                            // entry in `AppServiceProvider` and a new
                            // `UserPolicy` method, neither of which this
                            // change owns. Flagged as follow-up, not fixed
                            // here by widening the branch back open.
                            Gate::authorize('user.suspend', $record);

                            if ($record->suspended_at) {
                                $service->unsuspend($actor, $record);
                                $action = AuditAction::USER_UNSUSPENDED;
                            } else {
                                $service->suspend($actor, $record);
                                $action = AuditAction::USER_SUSPENDED;

                                // §5.5: notice to the affected user, after
                                // the write succeeds. This is the half the
                                // plan calls a compliance problem as much
                                // as a product one — a suspension ends the
                                // session (§5.1) and, before this, said
                                // nothing to the person it locked out.
                                $record->notify(new AccountSuspended($data['reason']));
                            }

                            AuditLog::query()->create([
                                'actor_id' => $actor->id,
                                'action' => $action,
                                'subject_type' => User::class,
                                'subject_id' => $record->id,
                                // Was `[]`. §5.5: the reason is the whole
                                // point of the audit row for a moderation
                                // verb — without it the trail records that
                                // someone was suspended and nothing about
                                // why.
                                'metadata' => ['reason' => $data['reason']],
                                'created_at' => now(),
                            ]);
                        } catch (AuthorizationException|LastAdministratorException $e) {
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
                    }),
                // §6.2: "`softDelete` and `restore` are implemented and
                // have ZERO callers — the cheapest real capability in the
                // plan." These two closures are those callers, and they are
                // also the first and only call sites of
                // `AuditAction::USER_DELETED` / `USER_RESTORED`.
                //
                // ⚠️ The pair ships together, never one at a time. §6.2's
                // correction to rev 1 is that `restore()` was "a bare
                // forceFill with no self-check and no roster lock — it is
                // NOT guarded"; a Delete button landing before those guards
                // existed would have made this panel a one-way door, with
                // the only exit being a psql prompt. The guards are in
                // `UserDeletionService::restore()`'s own docblock.
                //
                // Both authorize `user.delete`, NOT a `user.delete` /
                // `user.restore` pair. There is no `user.restore` ability
                // and adding one is outside this change: it would need a
                // `Gate::define`, a `$mustFallThrough` entry
                // (§5.7's STANDING RULE — omit it and the ability is an
                // unconditional admin yes) and a new `UserPolicy` method,
                // all in `AppServiceProvider`/`UserPolicy`. See `restore`
                // below for the one consequence that has.
                Action::make('softDelete')
                    ->label('Delete')
                    ->color('danger')
                    ->visible(fn (User $record): bool => $record->deleted_at === null)
                    ->requiresConfirmation()
                    // §5.5's pattern, copied from `toggleSuspend` above
                    // rather than reinvented: required reason, recorded in
                    // the audit row, sent to the user verbatim. §5.5 names
                    // three verbs — "takedown/suspend/**delete**" — and
                    // delete was the one Phase 1 could not finish, because
                    // there was no moment at which a notice could be sent.
                    ->schema([
                        Textarea::make('reason')
                            ->label('Reason')
                            ->helperText('Recorded in the audit log and sent to the user verbatim.')
                            ->required()
                            ->maxLength(1000),
                    ])
                    ->action(function (User $record, array $data) {
                        $actor = auth()->user();
                        abort_if($actor === null, 403);

                        try {
                            // Hoisted above everything, per §5.4 hole 1's
                            // lesson: a Gate that sits inside one branch of
                            // a verb is worse than no Gate, because the file
                            // then reads as if it were guarded.
                            Gate::authorize('user.delete', $record);

                            app(UserDeletionService::class)->softDelete($actor, $record);

                            AuditLog::query()->create([
                                'actor_id' => $actor->id,
                                'action' => AuditAction::USER_DELETED,
                                'subject_type' => User::class,
                                'subject_id' => $record->id,
                                'metadata' => ['reason' => $data['reason']],
                                'created_at' => now(),
                            ]);

                            // After the write, never before — same ordering
                            // as `toggleSuspend`. A notice sent ahead of a
                            // `LastAdministratorException` rollback cannot
                            // be unsent.
                            //
                            // `mail` is the load-bearing channel here and
                            // `AccountDeleted`'s docblock explains why:
                            // §5.1's `CheckUserIsActive` treats `deleted_at`
                            // as terminal for access, so the recipient is
                            // signed out and cannot read an in-app
                            // notification.
                            $record->notify(new AccountDeleted($data['reason']));
                        } catch (AuthorizationException|LastAdministratorException $e) {
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
                    }),
                Action::make('restore')
                    ->label('Restore')
                    ->visible(fn (User $record): bool => $record->deleted_at !== null)
                    ->requiresConfirmation()
                    // A reason is required in this direction too, for the
                    // same reason `toggleSuspend` requires one on its
                    // reinstatement branch: on an adverse decision it is the
                    // statement sent to the user, on a reversal it is the
                    // operator's note for the trail. "Who let this account
                    // back in, and why" is the question an appeal review
                    // actually asks, and `audit_log` is the only place that
                    // can answer it (§6.2: `users.suspended_by_id` does not
                    // exist and will not be added).
                    ->schema([
                        Textarea::make('reason')
                            ->label('Reason')
                            ->helperText('Recorded in the audit log.')
                            ->required()
                            ->maxLength(1000),
                    ])
                    ->action(function (User $record, array $data) {
                        $actor = auth()->user();
                        abort_if($actor === null, 403);

                        try {
                            // ⚠️ `user.delete` reads backwards on a
                            // restoration, in exactly the way
                            // `toggleSuspend`'s docblock records for
                            // `user.suspend`: `UserPolicy::delete()` is
                            // `canModerate()`, whose third clause is
                            // `! wouldOrphanAdminRoster($target)` — "would
                            // REMOVING this user zero the admin roster",
                            // which is not a question a restoration asks.
                            //
                            // It is nonetheless SAFE here, and the reason
                            // is worth writing down because it is not
                            // obvious from the clause: `remainingAdminCount
                            // Excluding($target)` counts every alive,
                            // unsuspended, non-anonymized admin-tier user
                            // other than the target — which INCLUDES the
                            // actor, who must be admin-tier to pass
                            // `canModerate()`'s first clause and must be
                            // alive and unsuspended to have a session at
                            // all (§5.1's `CheckUserIsActive`). So the
                            // count is never below 1 on this path and the
                            // clause can never fire. Verified by test, not
                            // by reading: `UserSurfaceTest` pins that a
                            // soft-deleted sole administrator CAN be
                            // restored.
                            //
                            // The Gate stays as-is rather than being
                            // widened or replaced. A dedicated
                            // `user.restore` ability would be the clean
                            // expression of this, and it needs a
                            // `Gate::define`, a `$mustFallThrough` entry
                            // (§5.7's STANDING RULE) and a new `UserPolicy`
                            // method — none of which this change owns.
                            // Flagged as follow-up, not papered over by
                            // dropping the Gate.
                            Gate::authorize('user.delete', $record);

                            app(UserDeletionService::class)->restore($actor, $record);

                            AuditLog::query()->create([
                                'actor_id' => $actor->id,
                                'action' => AuditAction::USER_RESTORED,
                                'subject_type' => User::class,
                                'subject_id' => $record->id,
                                'metadata' => ['reason' => $data['reason']],
                                'created_at' => now(),
                            ]);

                            // No notification, and that is a decision on the
                            // record rather than an omission —
                            // `AccountDeleted`'s docblock states it
                            // ("deliberately no counterpart notice on
                            // `restore()`") and `toggleSuspend` is the
                            // precedent: §5.5's notification duty attaches
                            // to the ADVERSE decision, and a reinstatement
                            // announces itself the moment the person can
                            // sign in again. Sending one would also mean a
                            // new `App\Notifications` class, which this
                            // change does not own.
                        } catch (AuthorizationException|LastAdministratorException $e) {
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
                    }),
                // §4's "Grant / revoke `admin`, `super_admin`" row — the
                // ONLY super_admin-only actions in this panel, and the first
                // call sites of `role.grantSuperAdmin`/`role.revokeSuperAdmin`
                // anywhere outside a test. §5.3 reported both as "phantom
                // abilities": reserved in `$mustFallThrough` since STEP-12
                // with no `Gate::define`, which denied everyone, so "there
                // is no path to grant `super_admin` at all." Phase 1 gave
                // them policy bodies; this gives them a button.
                //
                // §8.2 is the rule both follow, and it is why each has TWO
                // guards that look redundant and are not:
                //
                //  - `->visible()` keeps a plain admin from seeing a button
                //    they cannot use. That is ERGONOMICS. Filament's own
                //    vendor comment is blunt about its worth as security —
                //    "hiding a resource from navigation does NOT prevent
                //    direct URL access" — and a Livewire `callAction`
                //    payload is exactly that direct path.
                //  - `Gate::authorize(...)` inside the closure is the
                //    ENFORCEMENT. §5.4's eight holes were all of this shape:
                //    a surface that looked gated from the outside and
                //    authorized nothing on the inside.
                Action::make('grantAdminRole')
                    ->label('Grant admin role')
                    ->visible(fn (): bool => auth()->user()?->hasRole(Role::SUPER_ADMIN) === true)
                    ->requiresConfirmation()
                    ->schema([
                        Select::make('role')
                            ->label('Role')
                            ->helperText('Only a super_admin may grant either of these.')
                            ->options([
                                Role::ADMIN => 'Admin',
                                Role::SUPER_ADMIN => 'Super admin',
                            ])
                            ->required(),
                    ])
                    ->action(function (User $record, array $data) {
                        $actor = auth()->user();
                        abort_if($actor === null, 403);

                        try {
                            Gate::authorize('role.grantSuperAdmin', $record);

                            // ⚠️ THE enforcement of §0/Q0's
                            // certification-review rule, not belt-and-braces
                            // with the Select's own `options()`. The class
                            // docblock above spells out the whole argument;
                            // the short version is that `$data['role']`
                            // arrives from a Livewire payload, and
                            // `RoleAssignmentService`'s allowlist accepts
                            // `coach` because
                            // `CoachApplicationDecisionService::approve()`
                            // needs it to. Without this line, a tampered
                            // `role` of `coach` would walk a user straight
                            // past the application-and-documents
                            // precondition that is the only legal route to
                            // that role.
                            //
                            // 422 and `abort_if` rather than a Notification:
                            // this is not a permission decision about the
                            // actor (the Gate above already made that one)
                            // and it is not reachable from the rendered
                            // form, so it is a tampered request, and
                            // matching `RoleAssignmentService::assign()`'s
                            // own self-check status keeps the two
                            // indistinguishable to a caller.
                            abort_if(
                                ! in_array($data['role'] ?? null, Role::SUPER_ADMIN_ONLY_GRANTS, true),
                                422,
                                'Only the admin and super_admin roles may be granted here.',
                            );

                            // §5.7: no `ROLE_ASSIGNED` write here. It lives
                            // inside `RoleAssignmentService::assign()`,
                            // inside the same transaction as the role
                            // change, which is what makes the audit row an
                            // invariant of the grant rather than something
                            // each caller has to remember. A second write
                            // here would log one grant twice — the exact
                            // duplication `revokeCoach` above had removed.
                            app(RoleAssignmentService::class)->assign($actor, $record, $data['role']);
                        } catch (AuthorizationException|LastAdministratorException $e) {
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
                    }),
                Action::make('revokeAdminRole')
                    ->label('Revoke admin role')
                    // Also hidden when the target holds neither role, so the
                    // button never offers a no-op. `hasAnyRole` with
                    // `Role::ADMIN_TIER` rather than two `hasRole` calls,
                    // per §5.2's whole point: that constant is the single
                    // written statement of "holds administrative power".
                    ->visible(fn (User $record): bool => auth()->user()?->hasRole(Role::SUPER_ADMIN) === true
                        && $record->hasAnyRole(Role::ADMIN_TIER))
                    ->requiresConfirmation()
                    ->schema([
                        Select::make('role')
                            ->label('Role')
                            // Only the administrative roles the target
                            // actually holds, so the form cannot offer a
                            // revocation that would be a no-op. `coach` and
                            // `member` are absent for a different and
                            // harder reason: `coach` has its own
                            // `revokeCoach` action above (§6.8 treats coach
                            // demotion as unconditional and separate), and
                            // revoking `member` would strip the baseline
                            // role every account holds.
                            ->options(function (User $record): array {
                                $options = [];

                                if ($record->hasRole(Role::ADMIN)) {
                                    $options[Role::ADMIN] = 'Admin';
                                }

                                if ($record->hasRole(Role::SUPER_ADMIN)) {
                                    $options[Role::SUPER_ADMIN] = 'Super admin';
                                }

                                return $options;
                            })
                            ->required(),
                    ])
                    ->action(function (User $record, array $data) {
                        $actor = auth()->user();
                        abort_if($actor === null, 403);

                        try {
                            // ⚠️ `role.revokeSuperAdmin` deliberately does
                            // NOT exclude self, unlike every other ability
                            // in `UserPolicy`. That is recorded in
                            // `UserPolicy::revokeSuperAdmin`'s own docblock:
                            // a self-check "would make the senior tier the
                            // only role on the platform nobody can ever
                            // leave," and `wouldOrphanAdminRoster($target)`
                            // already covers the one dangerous case (the
                            // last admin demoting themselves) better than a
                            // self-check would, since a self-check would
                            // also block the safe case. So a super_admin
                            // CAN step down through this button, and cannot
                            // strand the platform by doing so.
                            Gate::authorize('role.revokeSuperAdmin', $record);

                            abort_if(
                                ! in_array($data['role'] ?? null, Role::SUPER_ADMIN_ONLY_GRANTS, true),
                                422,
                                'Only the admin and super_admin roles may be revoked here.',
                            );

                            // `LastAdministratorException` is the expected
                            // outcome of revoking the final administrator,
                            // and the catch below turns it into a red toast
                            // rather than Filament's raw error page — the
                            // same treatment `revokeCoach` gives it.
                            app(RoleAssignmentService::class)->revoke($actor, $record, $data['role']);
                        } catch (AuthorizationException|LastAdministratorException $e) {
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
                    }),
            ])
            ->toolbarActions([
                BulkAction::make('suspendSelected')
                    ->label('Suspend selected (max 25)')
                    ->requiresConfirmation()
                    // §5.5 applies to the bulk path too, and it had a
                    // second gap of its own: this action wrote NO audit row
                    // at all, so a 25-user suspension was invisible in
                    // `audit_log` while a single one was not. Both are
                    // fixed together below — a bulk verb that skips the
                    // trail is the same defect class as one that skips the
                    // Gate (§7.4's own warning about bulk actions).
                    ->schema([
                        Textarea::make('reason')
                            ->label('Reason')
                            ->helperText('Recorded against every selected user and sent to each of them verbatim.')
                            ->required()
                            ->maxLength(1000),
                    ])
                    ->action(function (Collection $records, array $data) {
                        $actor = auth()->user();
                        abort_if($actor === null, 403);

                        try {
                            // §7.4/§3: still through UserDeletionService's
                            // own cap + per-target last-admin guard, never
                            // a raw ->each->update() on the collection.
                            // `values()` reindexes to a list<User> —
                            // `$records` may arrive with non-sequential
                            // keys (e.g. after table filtering/sorting),
                            // and `suspendMany()`'s signature requires a
                            // list, not an arbitrary keyed array.
                            /** @var list<User> $targets */
                            $targets = $records->values()->all();
                            foreach ($targets as $target) {
                                Gate::authorize('user.suspend', $target);
                            }
                            app(UserDeletionService::class)->suspendMany($actor, $targets);

                            // Audit + notify only once the whole batch has
                            // landed. `suspendMany()` is all-or-nothing by
                            // exception (the first last-admin or over-cap
                            // target aborts the loop), so writing per
                            // target inside the loop would leave rows
                            // claiming suspensions that a later throw
                            // prevented — and notifications that cannot be
                            // unsent.
                            foreach ($targets as $target) {
                                AuditLog::query()->create([
                                    'actor_id' => $actor->id,
                                    'action' => AuditAction::USER_SUSPENDED,
                                    'subject_type' => User::class,
                                    'subject_id' => $target->id,
                                    'metadata' => ['reason' => $data['reason'], 'bulk' => true],
                                    'created_at' => now(),
                                ]);

                                $target->notify(new AccountSuspended($data['reason']));
                            }
                        } catch (\InvalidArgumentException|AuthorizationException|LastAdministratorException $e) {
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
                    }),
            ]);
    }

    /**
     * §8.2's "super-admin-only surfaces" rule, applied to the ONE
     * authorization decision §6.2's detail page introduces — and applied
     * HERE rather than in a policy, which is the part §1.2 insists on: "no
     * `viewAny` exists in `app/Policies/` and Laravel's missing-method
     * fallback is `Response::allow()`," so a policy-shaped answer to this
     * question is an unconditional yes wearing a guard's uniform.
     *
     * This one override covers both paths that can reach `Pages\ViewUser`,
     * which is why it is on `getViewAuthorizationResponse()` and not on
     * `canView()`:
     *
     *  - `ViewRecord::authorizeAccess()` (run from `mount`) calls
     *    `canView($record)`, and `HasAuthorization::canView()` is
     *    `getViewAuthorizationResponse($record)->allowed()` — so
     *    overriding the response method covers the bool method, while
     *    overriding `canView()` alone would NOT have covered the response
     *    method.
     *  - `Resources\Pages\Page::getDefaultActionAuthorizationResponse()`
     *    calls `getViewAuthorizationResponse($record)` directly for the
     *    `ViewAction` in the table above.
     *
     * The predicate is `Role::ADMIN_TIER`, not `Role::SUPER_ADMIN`: §4
     * makes the user detail page an admin-tier read. It is restated here
     * anyway, rather than left to `EnsureUserIsAdmin`, because
     * `POST livewire/update` runs the `web` middleware group alone —
     * `AdminPanelProvider` declares its own middleware array and never
     * uses `web` — so no panel middleware is in the stack for a Livewire
     * round trip. `MostConnectionsWidget::canView()` carries the same note
     * for the same reason.
     *
     * ⚠️ `auth()->user()` can be null here in a way the panel's own
     * middleware would prevent, and the null branch must DENY. Returning
     * `Response::allow()` for an unauthenticated caller is the
     * `Response::allow()` fallback bug this method exists to avoid,
     * reintroduced by hand.
     */
    public static function getViewAuthorizationResponse(Model $record): Response
    {
        $actor = auth()->user();

        return $actor !== null && $actor->hasAnyRole(Role::ADMIN_TIER)
            ? Response::allow()
            : Response::deny('Only an administrator may view a user record.');
    }

    /**
     * @return array<string, PageRegistration>
     */
    public static function getPages(): array
    {
        return [
            'index' => ManageUsers::route('/'),
            // §6.2's detail page. `{record}` is what
            // `Page::getDefaultActionUrl()` fills from the `ViewAction`
            // above, and registering the key `view` is also what turns that
            // action from a modal into a link (see its comment).
            'view' => ViewUser::route('/{record}'),
        ];
    }
}
