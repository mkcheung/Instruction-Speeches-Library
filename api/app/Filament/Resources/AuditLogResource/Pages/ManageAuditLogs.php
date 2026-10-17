<?php

namespace App\Filament\Resources\AuditLogResource\Pages;

use App\Filament\Resources\AuditLogResource;
use Filament\Resources\Pages\ManageRecords;

/**
 * §7.10: a `ManageRecords`-only page, same shape as
 * `ConnectionResource\Pages\ManageConnections` — there is no create/edit
 * route to register because this resource has no creation path at all.
 */
class ManageAuditLogs extends ManageRecords
{
    protected static string $resource = AuditLogResource::class;
}
