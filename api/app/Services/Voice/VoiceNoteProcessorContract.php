<?php

namespace App\Services\Voice;

use App\Models\SpeechAsset;

interface VoiceNoteProcessorContract
{
    public function process(SpeechAsset $asset, string $temporaryPath): bool;
}
