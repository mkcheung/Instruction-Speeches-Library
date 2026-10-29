<?php

namespace App\Filament\Resources\CoachApplicationResource\Pages;

use App\Filament\Resources\CoachApplicationResource;
use Filament\Resources\Pages\ManageRecords;

/**
 * The application list: status only, undecided first. Each row links to
 * `ViewCoachApplication`, where the statement, the documents and the
 * Approve / Reject decision live (PLAN-COACH-APPLICATION-REVIEW-PAGE.md).
 */
class ManageCoachApplications extends ManageRecords
{
    protected static string $resource = CoachApplicationResource::class;
}
