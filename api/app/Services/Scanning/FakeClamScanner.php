<?php

namespace App\Services\Scanning;

/**
 * Bound in testing/CI (App\Providers\AppServiceProvider), mirroring
 * `App\Services\Transcoding\FakeTranscoder` — always reports clean, so the
 * upload/scan-job wiring is testable without a real `clamd` socket
 * present. A dedicated Pest test exercises the "infected" branch by
 * swapping in a small anonymous class bound over this contract, never by
 * making this fake configurable via a static/global flag.
 */
class FakeClamScanner implements ClamScannerContract
{
    public function isClean(string $absolutePath): bool
    {
        return true;
    }
}
