<?php

namespace App\Filament\Resources\ReportResource\Pages;

use App\Filament\Resources\ReportResource;
use Filament\Resources\Pages\ManageRecords;

/**
 * The report queue built at STEP-11 (`php artisan reports:list` until
 * now) — one page, resolve/dismiss actions inline on the table.
 */
class ManageReports extends ManageRecords
{
    protected static string $resource = ReportResource::class;
}
