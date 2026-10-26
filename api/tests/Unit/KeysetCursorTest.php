<?php

use App\Support\KeysetCursor;

it('round trips stored timestamps including microseconds without changing the legacy cursor format', function (string $timestamp) {
    $encoded = KeysetCursor::encode($timestamp, 42);
    expect(base64_decode($encoded))->toBe($timestamp.'|42');
    expect(KeysetCursor::decode($encoded))->toBe([$timestamp, 42]);
    expect(KeysetCursor::validTimestamp($timestamp))->toBeTrue();
})->with(['2026-01-02 03:04:05', '2024-02-29 03:04:05.123456']);

it('restarts legacy pagination for malformed cursor values', function (mixed $cursor) {
    expect(KeysetCursor::decode($cursor))->toBeNull();
})->with([[null], [''], [[]], ['%%%'], [base64_encode('2026-02-30 03:04:05|1')], [base64_encode('2026-01-02T03:04:05Z|1')], [base64_encode('2026-01-02 03:04:05|oops')], [base64_encode('2026-01-02 03:04:05|1|2')]]);
