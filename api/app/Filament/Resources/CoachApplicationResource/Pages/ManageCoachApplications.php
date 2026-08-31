<?php

namespace App\Filament\Resources\CoachApplicationResource\Pages;

use App\Filament\Resources\CoachApplicationResource;
use Filament\Resources\Pages\ManageRecords;

/**
 * The application queue, oldest-first — approve/reject actions live inline
 * on the table (see the resource's own `table()`), so a single page is
 * all this needs, no separate view/edit route.
 */
class ManageCoachApplications extends ManageRecords
{
    protected static string $resource = CoachApplicationResource::class;
}
