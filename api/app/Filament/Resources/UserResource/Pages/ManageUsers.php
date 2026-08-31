<?php

namespace App\Filament\Resources\UserResource\Pages;

use App\Filament\Resources\UserResource;
use Filament\Resources\Pages\ManageRecords;

/**
 * List-and-moderate only — no admin-created users, no edit form. A single
 * page (`ManageRecords`, not `ListRecords` + `CreateRecord`/`EditRecord`)
 * is the correct shape here, matching STEP-12.md's actual scope: "user
 * list with a role filter," not user CRUD.
 */
class ManageUsers extends ManageRecords
{
    protected static string $resource = UserResource::class;
}
