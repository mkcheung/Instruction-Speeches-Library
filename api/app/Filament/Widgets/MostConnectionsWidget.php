<?php

namespace App\Filament\Widgets;

use App\Models\Connection;
use App\Models\User;
use App\Support\Role;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Filament\Widgets\TableWidget;

/**
 * MODERNIZATION_PLAN §6.7.5 / STEP-13-FROZEN-CONTRACT.md §12: "the widget
 * that catches abuse" — who is unusually well-connected, or mass-requesting,
 * in the last 7 days. First Filament Widget in this codebase (no
 * `app/Filament/Widgets` directory existed before this step) — built
 * directly from Filament's own `TableWidget` API, no in-repo precedent to
 * follow.
 *
 * Deliberately a table, never a force-directed graph, per the plan's
 * explicit "resist the force-directed graph" instruction (§6.7.5): a graph
 * is illegible past ~50 nodes and answers none of the four questions an
 * admin actually has. This answers exactly one of them.
 *
 * Counts every mirrored row where `state IN ('pending', 'accepted')` and
 * `created_at` falls in the last 7 days, grouped by `owner_id` — since a
 * pair is two rows, this necessarily double-counts each accepted pair once
 * per side, which is fine (and arguably correct) for an abuse signal: a
 * user who mass-requests 50 people in a week shows up here as 50, not 25.
 *
 * ## It was never actually on screen until PLAN-ADMIN-DASHBOARD.md §6.1
 *
 * STEP-13 built, registered and tested this widget, and it rendered
 * nowhere. `discoverWidgets()` only puts a class into
 * `Filament::getWidgets()`, and the single caller of that method in the
 * whole framework is `Filament\Pages\Dashboard::getWidgets()`
 * (`filament/src/Pages/Dashboard.php:49`) — a class this codebase had no
 * subclass of, in a directory (`app/Filament/Pages`) that did not exist.
 * So it was a discovered, addressable Livewire component with no host page:
 * live enough to pass a `Livewire::test()`, invisible to every admin. §6.1
 * Phase 2a fixes that by creating `App\Filament\Pages\Dashboard`; the two
 * declarations below are the only changes this file needed.
 *
 * ## ⚠️ Cost of the query, and why it is left alone
 *
 * The `selectSub` is a **correlated subquery evaluated once per user row**,
 * and the `limit(25)` cannot help: the planner must compute
 * `recent_connections_count` for every row in `users` before
 * `ORDER BY ... DESC` can pick a top 25, so this is O(users × connections
 * -per-user) on every dashboard load — and it now runs on the panel's
 * landing page rather than nowhere, so the cost is real for the first time.
 * §6.1 states the verdict directly: "fine at 15 users, revisit at ~10k."
 * Deliberately NOT rewritten here. The rewrite (a `GROUP BY owner_id`
 * aggregate over `connections` joined back to `users`, which `ix_connections
 * _owner_state_connected` would serve) changes the result shape and would
 * need its own tests, and §10's whole argument is that a 15-row table does
 * not justify that work yet. When it does, this docblock is the trigger.
 */
class MostConnectionsWidget extends TableWidget
{
    protected static ?int $sort = 1;

    /**
     * PLAN-ADMIN-DASHBOARD.md §7 ("widget `$columnSpan` likewise").
     * `Filament\Widgets\Widget` defaults to `1`, which on §6.1's
     * `['md' => 2, 'xl' => 4]` dashboard grid would render this table in a
     * quarter-width column at 1280px — two columns and a search box inside
     * ~300px. A table widget is the one shape that always wants the full
     * row, and `'full'` is breakpoint-independent, so it needs no
     * per-breakpoint array.
     *
     * @var int|string|array<string, int|null>
     */
    protected int|string|array $columnSpan = 'full';

    /**
     * §8.2's widget gate. Not a change of who may see this — the panel
     * route is already `EnsureUserIsAdmin`-gated to `Role::ADMIN_TIER` —
     * but a change of *where* that is enforced. `POST livewire/update` runs
     * the `web` middleware group alone
     * (`php artisan route:list --path=livewire/update -v`), and
     * `AdminPanelProvider` declares its own middleware array and never uses
     * `web`, so no panel middleware is in the stack for a Livewire round
     * trip. This widget was discovered-and-addressable for all of STEP-13
     * with nothing but that route in front of it.
     *
     * One method covers both layers §8.2 requires:
     * `Page::getWidgetsSchemaComponents()` filters on `::canView()` before
     * emitting the schema (render-time), and
     * `Filament\Widgets\Concerns\CanAuthorizeAccess::hydrateCanAuthorizeAccess()`
     * runs `abort_unless(static::canView(), 403)` on every subsequent
     * request (hydrate). A policy would not work: §1.2 — no `viewAny`
     * exists in `app/Policies/` and Laravel's missing-method fallback is
     * `Response::allow()`.
     */
    public static function canView(): bool
    {
        $user = auth()->user();

        return $user !== null && $user->hasAnyRole(Role::ADMIN_TIER);
    }

    public function table(Table $table): Table
    {
        return $table
            ->heading('Most connections in the last 7 days')
            ->query(
                User::query()
                    ->select('users.*')
                    ->selectSub(
                        Connection::query()
                            ->selectRaw('count(*)')
                            ->whereColumn('owner_id', 'users.id')
                            ->whereIn('state', ['pending', 'accepted'])
                            ->where('created_at', '>=', now()->subDays(7)),
                        'recent_connections_count'
                    )
                    ->orderByDesc('recent_connections_count')
                    ->limit(25)
            )
            ->columns([
                TextColumn::make('username')->searchable(),
                TextColumn::make('recent_connections_count')->label('Connections (7d)')->sortable(),
            ]);
    }
}
