<?php

namespace App\Filament\Resources;

use App\Filament\Resources\ReportResource\Pages\ManageReports;
use App\Models\Report;
use Filament\Actions\Action;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\PageRegistration;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

/**
 * STEP-12-admin-portal.md: "the report queue (from step 11)." Reuses
 * STEP-11's `reports` table as-is (STEP-12-FROZEN-CONTRACT.md §10 —
 * "already correct and needs no new code" beyond this admin surface).
 */
class ReportResource extends Resource
{
    protected static ?string $model = Report::class;

    protected static ?string $navigationLabel = 'Reports';

    public static function form(Schema $schema): Schema
    {
        return $schema->components([]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn ($query) => $query->orderBy('created_at'))
            ->columns([
                TextColumn::make('reportable_type')->label('Type'),
                TextColumn::make('reason'),
                TextColumn::make('state')->badge(),
                TextColumn::make('created_at')->dateTime()->sortable(),
            ])
            ->filters([
                SelectFilter::make('state')->options(['open' => 'Open', 'actioned' => 'Actioned', 'dismissed' => 'Dismissed']),
            ])
            ->recordActions([
                Action::make('resolve')
                    ->visible(fn (Report $record) => $record->state === 'open')
                    ->requiresConfirmation()
                    ->schema([Textarea::make('resolution_note')->label('Resolution note')])
                    ->action(function (Report $record, array $data) {
                        $record->update([
                            'state' => 'actioned',
                            'resolved_by_id' => auth()->id(),
                            'resolved_at' => now(),
                            'resolution_note' => $data['resolution_note'] ?? null,
                        ]);
                        Notification::make()->success()->title('Report resolved.')->send();
                    }),
                Action::make('dismiss')
                    ->visible(fn (Report $record) => $record->state === 'open')
                    ->requiresConfirmation()
                    ->action(function (Report $record) {
                        $record->update([
                            'state' => 'dismissed',
                            'resolved_by_id' => auth()->id(),
                            'resolved_at' => now(),
                        ]);
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
