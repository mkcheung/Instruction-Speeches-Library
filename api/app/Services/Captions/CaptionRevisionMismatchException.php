<?php

namespace App\Services\Captions;

use RuntimeException;

/**
 * Thrown by App\Jobs\RederiveTranscript when a STILL-current job (the
 * asset's `content_revision` still equals the job's expected revision,
 * even after a locked re-read) reads back VTT bytes that don't hash to
 * that same expected revision — STEP-09-VERIFICATION-PLAN.md §4.1 point 3:
 * "a still-current mismatch becomes an explicit safe storage-integrity
 * failure rather than success." This can only mean the stored bytes are
 * corrupt/truncated, not a benign supersession (a genuine newer edit would
 * have also moved `content_revision`, which the locked re-read already
 * ruled out) — left to escape handle() so it retries/eventually fails via
 * the job's own tries budget instead of silently writing a transcript
 * derived from bytes that don't match what was promised.
 */
class CaptionRevisionMismatchException extends RuntimeException {}
