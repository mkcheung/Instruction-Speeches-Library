<?php

namespace App\Services\Scanning;

use RuntimeException;

/**
 * Talks to a real `clamd` daemon over TCP (compose.yaml's `clamav`
 * service, port 3310 — a warm, already-signature-loaded socket, which is
 * exactly why this step runs `clamd` rather than shelling out to
 * one-shot `clamscan` per file: signature loading is what makes ClamAV
 * slow to start, and a queued job hitting a cold `clamscan` process every
 * time would pay that cost per document instead of once at container
 * startup).
 *
 * Speaks ClamAV's INSTREAM protocol directly (a tiny length-prefixed
 * chunk protocol) rather than shelling out to `clamdscan`, so this class
 * has no dependency on any CLI tool being present in the `app`/
 * `queue-worker` image — only a TCP connection to the `clamav` service.
 *
 * "ClamAV is a good control against commodity malware and a weak one
 * against a targeted attacker" (STEP-12.md) — adopted as exactly that,
 * nothing more.
 */
class ClamdScanner implements ClamScannerContract
{
    /** Matches ClamAV's own default INSTREAM chunk size ceiling headroom. */
    private const CHUNK_SIZE = 8192;

    public function __construct(
        private readonly string $host = 'clamav',
        private readonly int $port = 3310,
        private readonly float $timeoutSeconds = 30.0,
    ) {}

    public function isClean(string $absolutePath): bool
    {
        $socket = @fsockopen($this->host, $this->port, $errno, $errstr, $this->timeoutSeconds);

        if ($socket === false) {
            throw new RuntimeException("ClamdScanner: could not connect to clamd at {$this->host}:{$this->port} ({$errstr}).");
        }

        try {
            stream_set_timeout($socket, (int) $this->timeoutSeconds);
            fwrite($socket, "zINSTREAM\0");

            $handle = fopen($absolutePath, 'rb');
            if ($handle === false) {
                throw new RuntimeException("ClamdScanner: could not open {$absolutePath} for scanning.");
            }

            try {
                while (! feof($handle)) {
                    $chunk = fread($handle, self::CHUNK_SIZE);
                    if ($chunk === false || $chunk === '') {
                        continue;
                    }
                    fwrite($socket, pack('N', strlen($chunk)).$chunk);
                }
            } finally {
                fclose($handle);
            }

            // Zero-length chunk terminates the stream, per clamd's INSTREAM protocol.
            fwrite($socket, pack('N', 0));

            $response = '';
            while (! feof($socket)) {
                $response .= fread($socket, self::CHUNK_SIZE);
            }

            // "stream: OK" or "stream: <SIGNATURE NAME> FOUND", NUL-terminated
            // under the `z` command prefix. Only a positive FOUND is a verdict
            // of infection: an empty reply (clamd restarted or the read timed
            // out), "... ERROR" (e.g. INSTREAM size limit exceeded) or anything
            // else is a scan FAILURE and must throw so ApplicationDocumentWork
            // retries it. Returning false here would stamp the document
            // `infected` and delete its bytes on a transient scanner hiccup.
            $reply = rtrim($response, "\0\r\n ");

            if (str_ends_with($reply, 'FOUND')) {
                return false;
            }

            if ($reply === 'OK' || str_ends_with($reply, ' OK')) {
                return true;
            }

            throw new RuntimeException('ClamdScanner: unexpected clamd reply ('.($reply === '' ? 'empty' : substr($reply, 0, 120)).').');
        } finally {
            fclose($socket);
        }
    }
}
