<?php

namespace App\Filament\Resources;

use App\Filament\Resources\ConnectionResource\Pages\ManageConnections;
use App\Models\Connection;
use Filament\Actions\ViewAction;
use Filament\Infolists\Components\TextEntry;
use Filament\Resources\Pages\PageRegistration;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

/**
 * STEP-13-FROZEN-CONTRACT.md §12 / MODERNIZATION_PLAN §6.7.5: "who is
 * connected to who" — tables and aggregates only, per the plan's explicit
 * "resist the force-directed graph" instruction. Four questions this
 * answers: who is X connected to, who is unusually well-connected (the
 * widget, see App\Filament\Widgets\MostConnectionsWidget), is this account
 * mass-requesting, and show me this pair's history — all four are a table
 * or a detail panel (`ViewConnection`), never a graph.
 *
 * `owner_id < peer_id` dedup, the exact seam SpeechResource's
 * `modifyQueryUsing` establishes for a different purpose — since every
 * connection is stored as two mirrored rows, without this every pair would
 * appear twice on the admin table.
 */
class ConnectionResource extends Resource
{
    protected static ?string $model = Connection::class;

    protected static ?string $navigationLabel = 'Connections';

    public static function form(Schema $schema): Schema
    {
        return $schema->components([]);
    }

    /**
     * The per-pair detail panel (STEP-13-FROZEN-CONTRACT.md §12): both
     * parties, the state, and the full timestamp history for this one
     * relationship — "show me this pair's history" answered directly,
     * without a graph.
     */
    public static function infolist(Schema $schema): Schema
    {
        return $schema->components([
            TextEntry::make('owner.username')->label('User A'),
            TextEntry::make('peer.username')->label('User B'),
            TextEntry::make('state')->badge(),
            TextEntry::make('initiatedBy.username')->label('Initiated by'),
            TextEntry::make('blockedBy.username')->label('Blocked by')->placeholder('—'),
            TextEntry::make('note')->placeholder('—'),
            TextEntry::make('requested_at')->dateTime(),
            TextEntry::make('responded_at')->dateTime(),
            TextEntry::make('connected_at')->dateTime(),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn ($query) => $query->whereColumn('owner_id', '<', 'peer_id')->with(['owner', 'peer']))
            ->columns([
                TextColumn::make('owner.username')->label('User A')->searchable(),
                TextColumn::make('peer.username')->label('User B')->searchable(),
                TextColumn::make('state')->badge(),
                TextColumn::make('requested_at')->dateTime(),
                TextColumn::make('connected_at')->dateTime(),
            ])
            ->filters([
                SelectFilter::make('state')->options([
                    'pending' => 'Pending',
                    'accepted' => 'Accepted',
                    'declined' => 'Declined',
                    'blocked' => 'Blocked',
                ]),
            ])
            ->recordActions([
                // The per-pair detail panel (§12): opens `infolist()` above
                // in a modal — same "no separate view route" shape every
                // other `ManageRecords`-only resource in this codebase uses
                // (SpeechResource/UserResource/ReportResource).
                ViewAction::make(),
            ]);
    }

    /**
     * @return array<string, PageRegistration>
     */
    public static function getPages(): array
    {
        return [
            'index' => ManageConnections::route('/'),
        ];
    }
}
