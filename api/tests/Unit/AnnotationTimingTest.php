<?php

use App\Support\AnnotationTiming;
use Illuminate\Validation\ValidationException;

it('normalizes decimal time without losing millisecond precision', function ($input, $expected) {
    expect(AnnotationTiming::milliseconds($input))->toBe($expected);
})->with([
    [0, 0], ['0.0004', 0], ['0.0005', 1], ['0.4995', 500], ['12.500', 12500],
    ['1.2345', 1235], ['9999999.999', 9999999999], ['1e-3', 1], ['5e-4', 1],
    ['1.5e2', 150000], ['00001.010', 1010], [12.5, 12500],
]);

it('rejects invalid or overflowing times', function ($input) {
    expect(fn () => AnnotationTiming::milliseconds($input))->toThrow(ValidationException::class);
})->with([[-1], ['-0.001'], [INF], [NAN], ['1:23'], ['1e100000'], ['10000000'], [null], [true], [[]]]);

it('applies half-open ranges and true point geometry', function ($lt, $ls, $le, $rt, $rs, $re, $expected) {
    expect(AnnotationTiming::overlaps($lt, $ls, $le, $rt, $rs, $re))->toBe($expected);
    expect(AnnotationTiming::overlaps($rt, $rs, $re, $lt, $ls, $le))->toBe($expected);
})->with([
    ['range', 10000, 15000, 'range', 15000, 20000, false],
    ['range', 10000, 15000, 'range', 14999, 20000, true],
    ['range', 10000, 15000, 'range', 11000, 12000, true],
    ['range', 10000, 15000, 'range', 10000, 15000, true],
    ['range', 10000, 15000, 'point', 10000, 10000, true],
    ['range', 10000, 15000, 'point', 12000, 12000, true],
    ['range', 10000, 15000, 'point', 15000, 15000, false],
    ['point', 10000, 10000, 'point', 10000, 10000, true],
    ['point', 10000, 10000, 'point', 10001, 10001, false],
]);
