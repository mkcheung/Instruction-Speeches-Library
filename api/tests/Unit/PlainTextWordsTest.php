<?php

use App\Support\PlainTextWords;

it('counts whitespace-delimited words', function (string $text, int $expected) {
    expect(PlainTextWords::count($text))->toBe($expected);
})->with([
    'empty' => ['', 0],
    'whitespace only' => ["  \n\t ", 0],
    'zero only' => ['0', 1],
    'zero among words' => ['we scored 0 goals', 4],
    'repeated zeros' => ['0 0 0', 3],
    'leading and trailing space' => ['  one two  ', 2],
    'unicode whitespace' => ["one\u{00A0}two\u{2003}three\u{3000}four", 4],
    'multibyte words' => ['café naïve 日本', 3],
]);

it('counts invalid UTF-8 as no words', function () {
    expect(PlainTextWords::count("\xB1\xB2 a"))->toBe(0);
});
