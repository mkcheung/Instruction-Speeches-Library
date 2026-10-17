<?php

namespace App\Filament\Resources;

use App\Filament\Resources\AuditLogResource\Pages\ManageAuditLogs;
use App\Models\AuditLog;
use App\Support\AuditAction;
use App\Support\Role;
use Filament\Forms\Components\DatePicker;
use Filament\Resources\Pages\PageRegistration;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\Filter;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use ReflectionClass;

/**
 * §7.10: `audit_log` is append-only and written by every destructive admin
 * action with a mandatory reason, but before this resource it was readable
 * in exactly one place — the last 50 rows for a single user, hardcoded with
 * no pagination, on `ViewUser` (`:365`). There was no way to ask "what
 * happened this week", "what has admin X been doing", or "who took this
 * speech down and why" without raw database access. This is that browser:
 * strictly read-only (no `recordActions`, no `toolbarActions`, no
 * create/edit/delete — see `table()`/`form()` below), because the moment
 * this table gains a write path through the panel it stops being an audit
 * log.
 */
class AuditLogResource extends Resource
{
    protected static ?string $model = AuditLog::class;

    /**
     * "People" (who the platform is made of) and "Moderation" (what needs
     * attention today) are the two existing groups
     * (`ConnectionResource`/`UserResource` vs `SpeechResource`/
     * `ReportResource`). An audit trail is neither a roster nor a queue —
     * it is oversight OF the people doing the moderating. Filed under
     * "People" anyway rather than inventing a third group for one
     * resource: it answers "what has admin X been doing", a question about
     * a person, not an open item.
     *
     * `canAccess()` below restricts to `super_admin` alone — not
     * `Role::ADMIN_TIER`. `IMPLEMENTATION-PLANS.md` §7.10's original text
     * specified ADMIN_TIER (citing `ModerationQueuesWidget.php:118-123`'s
     * precedent), but `Role.php`'s own `ADMIN_TIER` docblock and
     * `PLAN-ADMIN-DASHBOARD.md` §4's role matrix both list audit-log
     * oversight as exactly the capability that distinguishes `super_admin`
     * from plain `admin` — confirmed against `PLAN-ADMIN-DASHBOARD.md:18`
     * directly. Decided in favor of the role matrix: an `admin` who could
     * read this resource could see whether their own actions are being
     * watched, and could watch every OTHER admin too, which defeats the
     * oversight `super_admin` exists to provide. §7.10's text is the one
     * that's now stale on this point.
     */
    protected static \UnitEnum|string|null $navigationGroup = 'People';

    protected static \BackedEnum|string|null $navigationIcon = 'heroicon-o-clipboard-document-list';

    protected static ?int $navigationSort = 4;

    protected static ?string $navigationLabel = 'Audit log';

    /**
     * §7.10 / PLAN-ADMIN-DASHBOARD.md §5.7's own trap, verified directly
     * against `vendor/filament/filament/src/helpers.php`'s
     * `get_authorization_response()` and
     * `Resources/Resource/Concerns/HasAuthorization.php`: `canAccess()`
     * defaults to `canViewAny()`, which — with no `AuditLogPolicy` in
     * `app/Policies/` and Filament's authorization not in "strict" mode —
     * falls through to `Gate::forUser($user)->callBeforeCallbacks(...)`.
     * That DOES reach this app's `Gate::before` in `AppServiceProvider`,
     * which returns `true` for admin-tier and `null` (not `false`) for
     * everyone else — and a `null` from every `before` callback makes
     * Filament's helper fall through ONE MORE level to an unconditional
     * `Response::allow()` for literally anyone, not just admins. The whole
     * panel is gated to admin-tier today (`User::canAccessPanel()`), so
     * this is currently inert — but it is a real, latent hole that
     * activates the moment anything exposes this resource outside that
     * outer wrapper (a future non-panel route, a refactor of the panel
     * gate). Overriding here makes the resource correct on its own, never
     * dependent on the implicit `viewAny` auto-discovery path — mirrors
     * `ModerationQueuesWidget::canView()` (`:118-123`) in SHAPE only, not
     * in predicate (that widget grants ADMIN_TIER; this grants
     * `super_admin` alone — see the `navigationGroup` docblock above for
     * why), and is deliberately NOT a policy for the same reason: a
     * policy's own missing-method fallback is also `Response::allow()`,
     * which would silently permit everyone while reading like a
     * restriction.
     */
    public static function canAccess(): bool
    {
        $user = auth()->user();

        return $user !== null && $user->hasRole(Role::SUPER_ADMIN);
    }

    public static function form(Schema $schema): Schema
    {
        return $schema->components([]);
    }

    public static function table(Table $table): Table
    {
        return $table
            // Same mobile-usability reasoning as every other resource in
            // this panel (`ConnectionResource:80-91`).
            ->stackedOnMobile()
            ->modifyQueryUsing(fn (Builder $query) => $query->with('actor'))
            // Newest-first is the natural reading order for a trail.
            // Deliberately NOT backed by a dedicated `(created_at)` index:
            // the migration's three existing indexes
            // (`(actor_id, created_at)`, `(subject_type, subject_id)`,
            // `(action, created_at)`) already cover every filtered query
            // this resource issues, and §7.10 itself judges a bare
            // `(created_at)` index "not worth buying" at this table's size.
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('created_at')->label('When')->dateTime()->sortable(),
                // `actor_id` is `ON DELETE SET NULL` (migration docblock),
                // so a row whose actor's account was later deleted has a
                // genuinely null `actor` relation — not a bug, not a blank
                // cell. `users.username` is ALSO nullable (same three-case
                // reasoning as `ViewUser::moderationHistory()` — a human
                // with no username must not collapse into the same label
                // as no actor at all), so this is three cases, not two.
                TextColumn::make('actor.username')
                    ->label('Actor')
                    ->sortable()
                    ->getStateUsing(function (AuditLog $record): string {
                        if ($record->actor_id === null) {
                            return 'Deleted user';
                        }

                        $username = $record->actor?->username;

                        return is_string($username) && $username !== ''
                            ? $username
                            : 'User #'.$record->actor_id;
                    }),
                TextColumn::make('action')->label('Action'),
                // `subject_type`/`subject_id` is a bare morph pair with no
                // FK (migration docblock: "mirrors `notifications
                // .notifiable` / `reports.reportable_*`"), so there is no
                // relation to eager-load and nothing to join against —
                // rendered as the short class basename plus the id, which
                // is the readable form of exactly those two columns.
                TextColumn::make('subject_type')
                    ->label('Subject')
                    ->getStateUsing(function (AuditLog $record): string {
                        if ($record->subject_type === null) {
                            return '—';
                        }

                        $basename = class_basename($record->subject_type);

                        return $record->subject_id === null
                            ? $basename
                            : $basename.' #'.$record->subject_id;
                    }),
                // `metadata` is a free-form array column and real call
                // sites don't agree on a single key — `ReportController:
                // 61-68` writes `['report_id' => ..., 'reason' => ...]`,
                // `ReviewService` writes `['speech_id' => ...]`,
                // `RoleAssignmentService::audit()` writes `['role' =>
                // ...]`, and `UserResource`'s suspend/unsuspend actions
                // write `['reason' => ..., 'bulk' => ...]`. There is no
                // single field that is safe to extract across every
                // writer, so rather than pick one key and silently drop
                // the rest (or guess wrong and show nothing for an entire
                // class of rows), the whole array is rendered compactly as
                // JSON. `toJson()` guards against `json_encode` returning
                // `false` on malformed data without introducing a second
                // failure mode here.
                TextColumn::make('metadata')
                    ->label('Details')
                    ->getStateUsing(fn (AuditLog $record): string => self::metadataJson($record) ?? '—')
                    ->limit(60)
                    ->tooltip(fn (AuditLog $record): ?string => self::metadataJson($record)),
            ])
            ->filters([
                // ⚠️ `audit_log.action` is deliberately free text with no
                // DB-level CHECK (migration docblock: "§14's trigger list
                // is open-ended ... enumerating a CHECK today would
                // either omit STEP-12's future actions or need a
                // migration to widen it later"), so this is a plain
                // `SelectFilter`, never an enum cast — there is no enum to
                // cast against. The options are built via reflection
                // rather than hand-typed so a new `AuditAction` constant
                // is automatically filterable the day it is added, with
                // no second edit here to forget.
                SelectFilter::make('action')
                    ->options(function (): array {
                        $actions = array_values((new ReflectionClass(AuditAction::class))->getConstants());

                        return array_combine($actions, $actions);
                    }),
                // Mirrors `UserResource`'s `roles` relationship filter
                // pattern (`:234-237`): a plain `->relationship()` filter,
                // which resolves its own options from the `actor` relation
                // (every `User`, searchable by `username`) rather than a
                // hand-maintained list.
                SelectFilter::make('actor')
                    ->relationship('actor', 'username')
                    ->label('Actor')
                    ->searchable(),
                // No existing resource in this panel has a date-range
                // filter to mirror (checked `UserResource`'s `lifecycle`
                // filter above and every other resource for `DatePicker`/
                // a `->query()` date-comparison shape — none exists), so
                // this is the standard two-`DatePicker` custom filter.
                Filter::make('created_at')
                    ->schema([
                        DatePicker::make('from')->label('From'),
                        DatePicker::make('until')->label('Until'),
                    ])
                    ->query(function (Builder $query, array $data): Builder {
                        return $query
                            ->when(
                                $data['from'] ?? null,
                                fn (Builder $query, string $date): Builder => $query->whereDate('created_at', '>=', Carbon::parse($date)),
                            )
                            ->when(
                                $data['until'] ?? null,
                                fn (Builder $query, string $date): Builder => $query->whereDate('created_at', '<=', Carbon::parse($date)),
                            );
                    }),
            ]);
        // No `recordActions`, no `toolbarActions` — §7.10's own
        // instruction: "otherwise it stops being an audit log." There is
        // no `infolist()` either, unlike `ConnectionResource`'s per-pair
        // detail panel: every column here is already a flat scalar, so a
        // modal would add a second surface with nothing new to show.
    }

    /**
     * @return array<string, PageRegistration>
     */
    public static function getPages(): array
    {
        return [
            'index' => ManageAuditLogs::route('/'),
        ];
    }

    /**
     * Shared by the `metadata` column's `getStateUsing()` and `tooltip()`
     * above — both need the same JSON rendering of the same array, with the
     * same "empty array" / "json_encode failed" fallback to null, so this
     * is the one place that logic is written rather than two closures that
     * could silently drift from each other.
     */
    private static function metadataJson(AuditLog $record): ?string
    {
        if ($record->metadata === []) {
            return null;
        }

        $json = json_encode($record->metadata);

        return $json === false ? null : $json;
    }
}
