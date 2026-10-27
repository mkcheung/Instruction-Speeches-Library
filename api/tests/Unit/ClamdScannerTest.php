<?php

use App\Services\Scanning\ClamdScanner;

/**
 * Starts a one-shot fake clamd (a child PHP process on an ephemeral loopback
 * port) that swallows one INSTREAM request and answers with `$reply`
 * (NUL-terminated when `$terminate`), then closes the connection.
 *
 * @return array{process: resource, port: int}
 */
function startFakeClamd(string $reply, bool $terminate = true): array
{
    $script = <<<'PHP'
        $server = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
        $name = stream_socket_get_name($server, false);
        fwrite(STDOUT, substr($name, strrpos($name, ':') + 1)."\n");
        fflush(STDOUT);
        $conn = stream_socket_accept($server, 10);
        stream_set_timeout($conn, 5);
        $buffer = '';
        while (! feof($conn)) {
            $chunk = fread($conn, 8192);
            if ($chunk === '' || $chunk === false) {
                break;
            }
            $buffer .= $chunk;
            if (str_ends_with($buffer, "\0\0\0\0")) {
                break;
            }
        }
        fwrite($conn, base64_decode($argv[1]).($argv[2] === '1' ? "\0" : ''));
        fclose($conn);
        PHP;

    $process = proc_open(
        [PHP_BINARY, '-r', $script, '--', base64_encode($reply), $terminate ? '1' : '0'],
        [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
        $pipes,
    );

    $port = (int) trim((string) fgets($pipes[1]));

    return ['process' => $process, 'port' => $port];
}

function scanWithFakeClamd(string $reply, bool $terminate = true): bool
{
    ['process' => $process, 'port' => $port] = startFakeClamd($reply, $terminate);
    $file = tempnam(sys_get_temp_dir(), 'clamd-test-');
    file_put_contents($file, '%PDF-1.4 fake');

    try {
        return (new ClamdScanner('127.0.0.1', $port, 5.0))->isClean($file);
    } finally {
        @unlink($file);
        proc_terminate($process);
        proc_close($process);
    }
}

it('treats "stream: OK" as clean', function (bool $terminate) {
    expect(scanWithFakeClamd('stream: OK', $terminate))->toBeTrue();
})->with([[true], [false]]);

it('treats a FOUND reply as infected', function () {
    expect(scanWithFakeClamd('stream: Eicar-Test-Signature FOUND'))->toBeFalse();
});

it('does not read a signature name containing OK as a clean verdict', function () {
    expect(scanWithFakeClamd('stream: Win.Trojan.OK FOUND'))->toBeFalse();
});

it('fails the scan instead of declaring infection when clamd answers with an error or nothing', function (string $reply) {
    // A false here would stamp the document `infected` and delete its bytes on a transient scanner fault.
    expect(fn () => scanWithFakeClamd($reply))->toThrow(RuntimeException::class, 'unexpected clamd reply');
})->with([
    'empty reply (connection closed / read timed out)' => [''],
    'size limit' => ['INSTREAM size limit exceeded. ERROR'],
    'garbage' => ['???'],
]);
