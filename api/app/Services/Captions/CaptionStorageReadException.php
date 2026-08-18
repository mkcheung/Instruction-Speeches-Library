<?php

namespace App\Services\Captions;

use RuntimeException;

/**
 * Thrown by App\Jobs\RederiveTranscript when a still-current job cannot
 * read its captions asset's VTT bytes back off storage at all (STEP-09-
 * VERIFICATION-PLAN.md §4.1 point 3: "treats storage/network absence as
 * retryable"). Deliberately left to escape handle() rather than caught —
 * the job's own tries/backoff budget is what turns this into a retry, not
 * a catch-and-succeed.
 */
class CaptionStorageReadException extends RuntimeException {}
