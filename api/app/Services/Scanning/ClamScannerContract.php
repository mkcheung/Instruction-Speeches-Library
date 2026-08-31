<?php

namespace App\Services\Scanning;

/**
 * STEP-12-FROZEN-CONTRACT.md §5: the interface seam modeled directly on
 * `App\Services\Transcoding\TranscoderContract` (confirmed the canonical
 * pattern in this codebase, already copied for captions and voice) —
 * `FakeClamScanner` in testing/CI, the real `ClamdScanner` (talks to a
 * `clamd` socket) everywhere else, bound in
 * `AppServiceProvider::register()` the same conditional way.
 *
 * Never throws on an infected file — a positive scan result is a normal,
 * expected outcome, not an error. Only a genuine I/O/connection failure
 * to the scanner itself should throw (and does, from `ClamdScanner`,
 * which the queued job's own retry/failure handling covers — same
 * never-silently-stuck-processing contract `GenerateCaptions` follows).
 */
interface ClamScannerContract
{
    /**
     * Scan the file at `$absolutePath` and return true if clean, false if
     * infected.
     */
    public function isClean(string $absolutePath): bool;
}
