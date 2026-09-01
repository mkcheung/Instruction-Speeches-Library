<?php

namespace App\Filament\Widgets;

use App\Models\Connection;
use App\Models\User;
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
 */
class MostConnectionsWidget extends TableWidget
{
    protected static ?int $sort = 1;

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
