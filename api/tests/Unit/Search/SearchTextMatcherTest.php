<?php

use App\Services\Search\SearchTextMatcher;

it('preserves source strings, casing and literal nonoverlapping occurrences', function () {
    $matcher = new SearchTextMatcher;
    expect($matcher->parts('Before NEEDLE needle after', 'before needle needle after', 'needle'))->toBe([
        ['text' => 'Before ', 'matched' => false],
        ['text' => 'NEEDLE', 'matched' => true],
        ['text' => ' ', 'matched' => false],
        ['text' => 'needle', 'matched' => true],
        ['text' => ' after', 'matched' => false],
    ]);
    expect($matcher->parts('aaa', 'aaa', 'aa'))->toBe([
        ['text' => 'aa', 'matched' => true], ['text' => 'a', 'matched' => false],
    ])->and($matcher->parts('', '', 'a'))->toBe([])
        ->and($matcher->parts('<script>.*%_!</script>', '<script>.*%_!</script>', '.*%_!')[1])
        ->toBe(['text' => '.*%_!', 'matched' => true]);
});

it('does not apply PHP unicode casefolding to database-selected strings', function () {
    $matcher = new SearchTextMatcher;
    expect($matcher->parts('ſ', 'ſ', 's'))->toBe([['text' => 'ſ', 'matched' => false]])
        ->and($matcher->excerpt('ſ', 'ſ', 's'))->toBeNull()
        ->and($matcher->parts('İ', 'i', 'i'))->toBe([['text' => 'İ', 'matched' => true]])
        ->and($matcher->parts('É', 'é', 'é'))->toBe([['text' => 'É', 'matched' => true]])
        ->and($matcher->parts('É', 'É', 'é'))->toBe([['text' => 'É', 'matched' => false]]);
});

it('returns only a bounded excerpt around the first actual occurrence', function (string $prefix, string $suffix) {
    $matcher = new SearchTextMatcher;
    $source = $prefix.'NEEDLE'.$suffix;
    $excerpt = $matcher->excerpt($source, strtolower($source), 'needle');
    $visible = implode('', array_column($excerpt['parts'], 'text'));
    expect(mb_strlen($visible))->toBeLessThanOrEqual(360)
        ->and($visible)->toContain('NEEDLE')
        ->and(array_values(array_filter($excerpt['parts'], fn ($part) => $part['matched']))[0]['text'])->toBe('NEEDLE')
        ->and($excerpt['truncated_before'])->toBe(mb_strlen($prefix) > 177)
        ->and($excerpt['truncated_after'])->toBe(mb_strlen($suffix) > 177);
})->with([
    'start' => ['', str_repeat('z', 1000)],
    'middle' => [str_repeat('é😀', 500), str_repeat('語', 1000)],
    'end' => [str_repeat('z', 1000), ''],
    'short' => ['Before ', ' after'],
]);

it('retains the complete maximum-length phrase with multibyte context', function () {
    $matcher = new SearchTextMatcher;
    $phrase = str_repeat('😀', 255);
    $source = str_repeat('漢', 600).$phrase.str_repeat('é', 600);
    $excerpt = $matcher->excerpt($source, $source, $phrase);
    expect(mb_strlen(implode('', array_column($excerpt['parts'], 'text'))))->toBe(360)
        ->and(array_values(array_filter($excerpt['parts'], fn ($part) => $part['matched'])))->toBe([['text' => $phrase, 'matched' => true]])
        ->and($excerpt['truncated_before'])->toBeTrue()
        ->and($excerpt['truncated_after'])->toBeTrue();
});

it('marks every visible repetition without adding arbitrary excerpts', function () {
    $matcher = new SearchTextMatcher;
    $excerpt = $matcher->excerpt('foo foo foo', 'foo foo foo', 'foo');
    expect(array_filter($excerpt['parts'], fn ($part) => $part['matched']))->toHaveCount(3);
    expect($matcher->excerpt('Unrelated', 'unrelated', 'foo'))->toBeNull();
});

it('rejects unsupported expanding database lowercase maps rather than misleading offsets', function () {
    (new SearchTextMatcher)->parts('İ', "i\u{0307}", 'i');
})->throws(LogicException::class);
