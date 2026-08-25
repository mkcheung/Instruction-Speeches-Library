<?php

namespace App\Services\Voice;

use App\Models\SpeechAsset;

interface VoiceNoteTranscriberContract
{
    public function transcribe(SpeechAsset $asset): string;
}
