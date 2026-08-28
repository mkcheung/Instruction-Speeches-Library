<?php

namespace App\Services\Captions;

/**
 * STEP-09-captions.md §6.12: turns a parsed cue list (Vtt::parse()'s
 * output) into the attribute set App\Models\SpeechTranscript stores —
 * `body`, `segments` (cue timing, for click-to-seek), `word_count`, and
 * `words_per_minute`. This is the ONLY place those four columns are
 * computed; App\Jobs\GenerateCaptions (fresh whisper output, `source =
 * 'whisper'`) and the caption-edit re-derive path (`source = 'edited'`)
 * both call this same method so the two can never drift into different
 * counting rules.
 */
class TranscriptDeriver
{
    /**
     * @param  array<int, array{start: float, end: float, text: string}>  $cues
     * @return array{body: string, segments: array<int, array{start: float, end: float, text: string}>, word_count: int, words_per_minute: float|null}
     */
    public function derive(array $cues): array
    {
        $segments = array_values(array_map(
            fn (array $cue): array => ['start' => $cue['start'], 'end' => $cue['end'], 'text' => $cue['text']],
            $cues,
        ));

        $body = trim(implode(' ', array_map(
            fn (array $cue): string => $this->normalizeWhitespace($cue['text']),
            $cues,
        )));

        $wordCount = $this->wordCount($body);

        return [
            'body' => $body,
            'segments' => $segments,
            'word_count' => $wordCount,
            'words_per_minute' => $this->wordsPerMinute($wordCount, $cues),
        ];
    }

    private function normalizeWhitespace(string $text): string
    {
        return trim(preg_replace('/\s+/u', ' ', $text) ?? $text);
    }

    private function wordCount(string $body): int
    {
        if ($body === '') {
            return 0;
        }

        // Explicit `!== ''` rather than a bare `array_filter`: the callback-
        // less form drops every FALSY element, so the literal spoken word
        // "0" was deleted from the count ("we scored 0 goals" counted 3).
        // `$body` is already whitespace-collapsed and trimmed above, so
        // preg_split cannot yield an empty token anyway — deleting "0" was
        // the filter's only observable effect. Both `word_count` and the
        // `words_per_minute` derived from it were wrong, which matters
        // because pace comparison across speeches is the point of this table.
        return count(array_filter(
            preg_split('/\s+/u', $body) ?: [],
            fn (string $word): bool => $word !== '',
        ));
    }

    /**
     * @param  array<int, array{start: float, end: float, text: string}>  $cues
     */
    private function wordsPerMinute(int $wordCount, array $cues): ?float
    {
        if ($cues === [] || $wordCount === 0) {
            return null;
        }

        $start = min(array_column($cues, 'start'));
        $end = max(array_column($cues, 'end'));
        $durationMinutes = ($end - $start) / 60;

        if ($durationMinutes <= 0) {
            return null;
        }

        return round($wordCount / $durationMinutes, 1);
    }
}
