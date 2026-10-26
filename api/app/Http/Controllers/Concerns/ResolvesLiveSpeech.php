<?php

namespace App\Http\Controllers\Concerns;

use App\Exceptions\SpeechDeletedException;
use App\Models\Speech;

/** Shared state lookup only; each controller retains its own authorization order. */
trait ResolvesLiveSpeech
{
    private function resolveSpeech(string $speechId): Speech
    {
        $speech = Speech::withTrashed()->findOrFail($speechId);
        if ($speech->trashed()) {
            throw new SpeechDeletedException;
        }

        return $speech;
    }
}
