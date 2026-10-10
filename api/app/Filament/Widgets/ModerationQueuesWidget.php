<?php

namespace App\Filament\Widgets;

use App\Models\CoachApplication;
use App\Models\Report;
use App\Support\Role;
use Filament\Support\Icons\Heroicon;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

/**
 * PLAN-ADMIN-DASHBOARD.md §6.1 / §10 (Phase 2a) — the dashboard's stat row.
 *
 * ## Why only two tiles, and why these two
 *
 * §6.1 mandates exactly one: **open reports, served by
 * `reports_state_created_at_index`**. §10 deferred the other five tiles
 * *and* the index migration they needed, and gave the reason plainly:
 * "users 15, speeches 4, `audit_log` 0 rows. Seven indexes for tables you
 * can `SELECT *` in a millisecond." The cut was about paying for indexes up
 * front, not about the tiles being unwanted.
 *
 * The second tile is added under that same reasoning rather than against
 * it: **`ix_coach_app_queue ON coach_applications (status, submitted_at)`
 * already exists** (`2026_08_22_100001_create_coach_applications_table.php:82`,
 * created for "oldest-submitted-first admin queue"), so the coach-application
 * count costs no migration, no new index and no new table scan. It is also
 * the panel's only *other* queue where work piles up waiting for a human
 * decision, which is the single question this row exists to answer. **No
 * migration ships with this step.**
 *
 * | Tile                 | Query                                                   | Index that serves it              |
 * |----------------------|---------------------------------------------------------|-----------------------------------|
 * | Open reports         | `reports` WHERE `state = 'open'`                        | `reports_state_created_at_index`  |
 * | Applications waiting | `coach_applications` WHERE `status IN (submitted, …)`   | `ix_coach_app_queue`              |
 *
 * Both are leading-column predicates on a composite index, so both are
 * index-only lookups; neither needs the trailing timestamp column.
 *
 * ## Tiles deliberately NOT added
 *
 * `users` has no `created_at` index and `speech_assets` has no `status`
 * index, so "new users this week" and "stuck transcodes" — the two most
 * tempting additions — would each require the migration §10 cut. They stay
 * out. Any user-count tile would additionally have to write
 * `whereNull('deleted_at')` by hand: `App\Models\User` deliberately omits
 * the `SoftDeletes` trait (`User.php:145-146`), so `deleted_at` carries no
 * global scope and an unqualified `User::count()` silently counts deleted
 * accounts.
 *
 * ## Why the status list is duplicated here
 *
 * `['submitted', 'under_review']` mirrors
 * `CoachApplicationResource.php:51`'s own
 * `modifyQueryUsing(fn ($query) => $query->whereIn('status', ['submitted',
 * 'under_review'])->orderBy('submitted_at'))`, deliberately copied rather
 * than imported: a widget that reaches into a Resource to borrow its queue
 * definition couples the dashboard to that Resource's internals, and
 * `CoachApplication` exposes no scope or constant for the undecided set
 * (its statuses live in a raw-SQL CHECK constraint,
 * `…create_coach_applications_table.php:74-75`). The cost of the copy is
 * that the tile and the queue can drift; the tile is the half that would be
 * wrong, so if that list ever moves onto the model, move this with it.
 * `under_review` is included because an application an admin has merely
 * opened is still undecided — it has not left the queue.
 *
 * ## Why `canView()` — §8.2
 *
 * Same reasoning as `App\Filament\Pages\Dashboard::canAccess()`, with one
 * extra wrinkle that makes it matter more for a widget than for the page.
 * `POST livewire/update` runs the `web` middleware group **only**
 * (`php artisan route:list --path=livewire/update -v`), and the panel never
 * uses `web`, so `EnsureUserIsAdmin` is not in the stack for any Livewire
 * round trip. §8.2 asks for a widget gate enforced "at render-time
 * filtering **and** by a `hydrate` guard"; both come from this one method:
 *
 *  - render-time — `Page::getWidgetsSchemaComponents()` filters on
 *    `::canView()` before building the schema (`Pages/Page.php:427`), so a
 *    denied widget is never even emitted into the page;
 *  - hydrate — `Filament\Widgets\Concerns\CanAuthorizeAccess` runs
 *    `abort_unless(static::canView(), 403)` from
 *    `hydrateCanAuthorizeAccess()`, which is what stops the component
 *    staying directly addressable once a snapshot exists.
 *
 * It is a policy-free predicate on purpose (§1.2: no `viewAny` exists and
 * Laravel's missing-method fallback is `Response::allow()`, so a policy gate
 * here would allow everyone), and it tests `Role::ADMIN_TIER` rather than
 * `Role::ADMIN` because the roles never stack and an `admin`-only check
 * locks out `super_admin` (§5.2).
 */
class ModerationQueuesWidget extends StatsOverviewWidget
{
    /**
     * Ahead of `MostConnectionsWidget` (`$sort = 1`). Panel widgets are
     * ordered by `::getSort()` in `Panel\Concerns\HasComponents::getWidgets()`,
     * and the default is `static::$sort ?? -1` — so leaving this null would
     * already sort first, by accident. Stated explicitly because "the
     * numbers happen to work out" is not an ordering.
     */
    protected static ?int $sort = 0;

    /**
     * Container-query breakpoints (`@md`), not viewport breakpoints (`md`),
     * because `StatsOverviewWidget::getSectionContentComponent()` wraps the
     * stats in a `Section` with `->gridContainer()`. The inherited default
     * for a row of fewer than three stats is `['@xl' => 3, '!@lg' => 3]`,
     * which lays two tiles into a three-wide grid and leaves a dangling
     * empty cell. `support/resources/css/components/grid.css` resolves
     * `@md:fi-grid-cols` inside a `@supports (container-type: inline-size)`
     * block and the class is present in the shipped
     * `support/dist/index.css`, so this needs no asset build either (§8.3).
     *
     * @var int|array<string, ?int>|null
     */
    protected int|array|null $columns = ['default' => 1, '@md' => 2];

    public static function canView(): bool
    {
        $user = auth()->user();

        return $user !== null && $user->hasAnyRole(Role::ADMIN_TIER);
    }

    /**
     * @return array<Stat>
     */
    protected function getStats(): array
    {
        return [
            // `'open'` as a literal: `Report::STATES` is a flat
            // `['open', 'actioned', 'dismissed']` list with no per-state
            // constant, and the same literal is what `ReportFactory`,
            // `ReportResource` and `reports:list` all write.
            Stat::make('Open reports', Report::query()->where('state', 'open')->count())
                ->description('Awaiting resolve or dismiss')
                ->descriptionIcon(Heroicon::OutlinedFlag)
                ->color('danger'),

            Stat::make(
                'Coach applications waiting',
                CoachApplication::query()->whereIn('status', ['submitted', 'under_review'])->count(),
            )
                ->description('Submitted or under review, undecided')
                ->descriptionIcon(Heroicon::OutlinedAcademicCap)
                ->color('warning'),
        ];
    }
}
