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

    protected static \BackedEnum|string|null $navigationIcon = 'heroicon-o-arrows-right-left';

    protected static ?int $navigationSort = 3;

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
