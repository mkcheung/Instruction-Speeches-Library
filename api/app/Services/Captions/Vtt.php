<?php

namespace App\Services\Captions;

/**
 * A minimal WebVTT reader/writer — just enough of the spec for this
 * product's needs (STEP-09-captions.md): a `WEBVTT` header, optional cue
 * identifiers, one `start --> end` timing line per cue (cue settings like
 * `position:`/`line:` are tolerated but ignored — this product never emits
 * them and doesn't need to round-trip them), and cue text.
 *
 * This is the SINGLE parsing boundary for both directions:
 *   - GenerateCaptions/WhisperTranscriber write a VTT string this class can
 *     always re-parse (so what whisper.cpp produces and what the speaker's
 *     editor saves are validated identically).
 *   - App\Http\Requests\Caption\UpdateCaptionsRequest validates a
 *     speaker-submitted edit through parse() before anything is persisted
 *     (the frozen contract's "server-side VTT validation... 422 on invalid
 *     VTT").
 *   - App\Models\SpeechTranscript derivation (TranscriptDeriver) always
 *     starts from parse()'s cue list — never a second, divergent parser.
 */
class Vtt
{
    /**
     * @return array<int, array{start: float, end: float, text: string}>
     *
     * @throws InvalidVttException
     */
    public static function parse(string $content): array
    {
        // Strip a UTF-8 BOM if present (WebVTT permits one before the
        // literal "WEBVTT" signature) and normalize line endings.
        $normalized = preg_replace('/^\xEF\xBB\xBF/', '', $content) ?? $content;
        $normalized = str_replace(["\r\n", "\r"], "\n", $normalized);
        $lines = explode("\n", $normalized);

        $first = trim((string) array_shift($lines) ?: '');

        if ($first !== 'WEBVTT' && ! str_starts_with($first, 'WEBVTT ') && ! str_starts_with($first, "WEBVTT\t")) {
            throw new InvalidVttException('A WebVTT file must begin with "WEBVTT".');
        }

        $timingPattern = '/^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})/';

        // Skip the header block (any header metadata lines) up to and
        // including the first blank line separating it from the cues.
        // Bounded by the first timing-line match, not blank-line alone: a
        // WebVTT string missing the blank separator between "WEBVTT" and
        // its first cue (no producer in this codebase emits one that way,
        // but nothing stops a hand-crafted or third-party-exported PUT
        // body from doing so) would otherwise have its entire first cue
        // consumed as "header metadata" — parse() would then silently
        // return zero cues instead of throwing, and
        // UpdateCaptionsRequest's validator only checks that parse()
        // doesn't throw, so a 422-should-have-fired input would pass
        // straight through as an empty transcript.
        while ($lines !== [] && trim($lines[0]) !== '' && ! preg_match($timingPattern, $lines[0])) {
            array_shift($lines);
        }
        while ($lines !== [] && trim($lines[0]) === '') {
            array_shift($lines);
        }

        $cues = [];
        $block = [];

        // Re-add a sentinel blank line so the last block flushes through
        // the same loop body as every other one.
        $lines[] = '';

        foreach ($lines as $line) {
            if (trim($line) === '') {
                if ($block !== []) {
                    $cues[] = self::parseBlock($block, $timingPattern);
                    $block = [];
                }

                continue;
            }

            $block[] = $line;
        }

        return $cues;
    }

    /**
     * @param  array<int, string>  $block
     * @return array{start: float, end: float, text: string}
     *
     * @throws InvalidVttException
     */
    private static function parseBlock(array $block, string $timingPattern): array
    {
        // A leading cue-identifier line (anything not itself a timing
        // line) is optional and, if present, discarded — this product
        // never reads it back.
        if (! preg_match($timingPattern, $block[0])) {
            array_shift($block);
        }

        if ($block === [] || ! preg_match($timingPattern, $block[0], $m)) {
            throw new InvalidVttException('Each cue must have a "start --> end" timing line.');
        }

        $start = self::toSeconds($m[1], $m[2], $m[3], $m[4]);
        $end = self::toSeconds($m[5], $m[6], $m[7], $m[8]);

        if ($end < $start) {
            throw new InvalidVttException('A cue\'s end time must not precede its start time.');
        }

        $text = trim(implode("\n", array_slice($block, 1)));

        return ['start' => $start, 'end' => $end, 'text' => $text];
    }

    private static function toSeconds(string $hours, string $minutes, string $seconds, string $millis): float
    {
        $h = $hours === '' ? 0 : (int) $hours;

        return ($h * 3600) + ((int) $minutes * 60) + (int) $seconds + ((int) $millis / 1000);
    }

    /**
     * Renders a cue list back to a WEBVTT string — the inverse of parse(),
     * used by App\Services\Captions\TranscriptDeriver's callers that need
     * to persist a freshly-derived or re-timed cue list (not currently
     * exercised outside tests, since WhisperTranscriber/the speaker's
     * editor both produce VTT text directly, but kept as the one place
     * that formats a timestamp correctly rather than reimplementing it).
     *
     * @param  array<int, array{start: float, end: float, text: string}>  $cues
     */
    public static function render(array $cues): string
    {
        $out = ["WEBVTT\n"];

        foreach ($cues as $cue) {
            $out[] = self::formatTimestamp($cue['start']).' --> '.self::formatTimestamp($cue['end']);
            $out[] = $cue['text'];
            $out[] = '';
        }

        return implode("\n", $out);
    }

    private static function formatTimestamp(float $seconds): string
    {
        $totalMs = (int) round($seconds * 1000);
        $h = intdiv($totalMs, 3_600_000);
        $m = intdiv($totalMs % 3_600_000, 60_000);
        $s = intdiv($totalMs % 60_000, 1000);
        $ms = $totalMs % 1000;

        return sprintf('%02d:%02d:%02d.%03d', $h, $m, $s, $ms);
    }
}
