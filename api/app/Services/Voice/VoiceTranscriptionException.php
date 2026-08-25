<?php

namespace App\Services\Voice;

use RuntimeException;

class VoiceTranscriptionException extends RuntimeException
{
    public function __construct(public readonly string $failureCode)
    {
        parent::__construct('Voice transcription failed.');
    }
}
