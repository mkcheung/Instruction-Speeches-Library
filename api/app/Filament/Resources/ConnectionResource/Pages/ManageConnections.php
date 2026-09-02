<?php

namespace App\Filament\Resources\ConnectionResource\Pages;

use App\Filament\Resources\ConnectionResource;
use Filament\Resources\Pages\ManageRecords;

/**
 * STEP-13-FROZEN-CONTRACT.md §12: the paired-down `owner_id < peer_id`
 * table — no admin-side creation, matching SpeechResource/ReportResource's
 * "browse only" shape.
 */
class ManageConnections extends ManageRecords
{
    protected static string $resource = ConnectionResource::class;
}
