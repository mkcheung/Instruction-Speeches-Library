<?php

namespace App\Services\Voice;

use App\Models\SpeechAsset;

class FakeVoiceNoteTranscriber implements VoiceNoteTranscriberContract
{
    public function transcribe(SpeechAsset $asset): string
    {
        return 'This is a fake voice-note transcript.';
    }
}
