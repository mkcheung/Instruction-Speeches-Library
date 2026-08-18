<?php

namespace App\Services\Captions;

/**
 * STEP-09-VERIFICATION-PLAN.md §4.1 "Projection convergence token": "One
 * shared helper is used by seed data, initial Whisper output, and manual
 * edits so generated captions also persist matching revisions." Every
 * writer of a canonical captions VTT (CaptionService::update,
 * WhisperTranscriber, FakeCaptionTranscriber, DeterministicCaptionTranscriber,
 * E2ECaptionsSeeder) calls this SAME method on the exact bytes it writes to
 * storage — the one guarantee App\Jobs\RederiveTranscript's whole
 * supersession check depends on: two callers hashing the same VTT string
 * must always agree.
 */
class CaptionRevision
{
    public static function compute(string $canonicalVtt): string
    {
        return hash('sha256', $canonicalVtt);
    }
}
