<?php

namespace App\Filament\Resources\SpeechResource\Pages;

use App\Filament\Resources\SpeechResource;
use Filament\Resources\Pages\ManageRecords;

/**
 * "All speeches" browse + takedown, per STEP-12.md — no admin speech
 * creation, so one page covers the whole surface.
 */
class ManageSpeeches extends ManageRecords
{
    protected static string $resource = SpeechResource::class;
}
