<?php

namespace App\Support;

use App\Exceptions\AnnotationOverlapException;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\SpeechAsset;
use Illuminate\Validation\ValidationException;

final class AnnotationTiming
{
    public const MAX_START_MS = 9_999_999_999;

    /** Exact decimal normalization, including legacy scientific numeric input. */
    public static function milliseconds(mixed $value, string $field = 'start_seconds'): int
    {
        if ((! is_string($value) && ! is_int($value) && ! is_float($value))
            || (is_float($value) && ! is_finite($value))
            || ! preg_match('/^\+?(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/D', (string) $value, $parts)) {
            throw ValidationException::withMessages([$field => ['Enter a finite, nonnegative time.']]);
        }
        $whole = ltrim($parts[1], '0');
        $fraction = $parts[2] ?? '';
        $exponent = (int) ($parts[3] ?? 0);
        if (abs($exponent) > 20 || strlen($whole) > 12 || strlen($fraction) > 30) {
            throw ValidationException::withMessages([$field => ['Time is outside the supported precision or range.']]);
        }
        $digits = $whole.$fraction;
        $places = strlen($whole) + $exponent + 3;
        if ($places < 0) {
            return 0;
        }
        if ($places > 12) {
            throw ValidationException::withMessages([$field => ['Time is outside the supported range.']]);
        }
        $prefix = substr(str_pad($digits, $places, '0'), 0, $places);
        $milliseconds = (int) $prefix + ((int) ($digits[$places] ?? '0') >= 5 ? 1 : 0);
        if ($milliseconds > self::MAX_START_MS) {
            throw ValidationException::withMessages([$field => ['Time is outside the supported range.']]);
        }

        return $milliseconds;
    }

    /** @return array{start_seconds: string, duration_seconds: string} */
    public function range(Review $review, mixed $start, mixed $duration, ?int $excludeId = null): array
    {
        $startMs = self::milliseconds($start);
        $durationMs = self::milliseconds($duration, 'duration_seconds');
        if ($durationMs < 500 || $durationMs > 120000) {
            throw ValidationException::withMessages(['duration_seconds' => ['Choose a segment between 0.5 and 120 seconds.']]);
        }
        if ($startMs + $durationMs > $this->speechDuration($review)) {
            throw ValidationException::withMessages(['duration_seconds' => ['The end must be within the speech.']]);
        }
        $this->available($review, 'range', $startMs, $startMs + $durationMs, $excludeId);

        return ['start_seconds' => self::seconds($startMs), 'duration_seconds' => self::seconds($durationMs)];
    }

    public function point(Review $review, mixed $start, ?int $excludeId = null): string
    {
        $startMs = self::milliseconds($start);
        if ($startMs >= $this->speechDuration($review)) {
            throw ValidationException::withMessages(['start_seconds' => ['Choose a voice position before the speech ends.']]);
        }
        $this->available($review, 'point', $startMs, $startMs, $excludeId);

        return self::seconds($startMs);
    }

    public function speechDuration(Review $review): int
    {
        $duration = SpeechAsset::query()->where('speech_id', $review->speech_id)
            ->where('kind', 'video')->where('status', 'ready')->where('is_primary', true)->value('duration_seconds');
        if ($duration === null || self::milliseconds($duration) === 0) {
            throw ValidationException::withMessages(['start_seconds' => ['Speech timing is unavailable until its video is ready.']]);
        }

        return self::milliseconds($duration);
    }

    public static function seconds(int $milliseconds): string
    {
        return intdiv($milliseconds, 1000).'.'.str_pad((string) ($milliseconds % 1000), 3, '0', STR_PAD_LEFT);
    }

    public static function overlaps(string $leftType, int $leftStart, int $leftEnd, string $rightType, int $rightStart, int $rightEnd): bool
    {
        if ($leftType === 'point') {
            return $rightType === 'point' ? $leftStart === $rightStart : $rightStart <= $leftStart && $leftStart < $rightEnd;
        }
        if ($rightType === 'point') {
            return $leftStart <= $rightStart && $rightStart < $leftEnd;
        }

        return $leftStart < $rightEnd && $rightStart < $leftEnd;
    }

    /** Caller holds Review lock. Unknown history conservatively reserves its old span. */
    public function available(Review $review, string $type, int $startMs, int $endMs, ?int $excludeId = null): void
    {
        $conflicts = [];
        foreach (Annotation::query()->where('review_id', $review->id)->get() as $row) {
            if ($row->id === $excludeId) {
                continue;
            }
            $otherStart = self::milliseconds($row->start_seconds);
            $otherType = $row->isPoint() ? 'point' : 'range';
            $otherEnd = $otherType === 'point' ? $otherStart : $otherStart + self::milliseconds($row->duration_seconds);
            if (self::overlaps($type, $startMs, $endMs, $otherType, $otherStart, $otherEnd)) {
                $conflicts[] = ['id' => (string) $row->id, 'timing_type' => $row->timing_type,
                    'start_seconds' => $otherStart / 1000, 'end_seconds' => $otherType === 'point' ? null : $otherEnd / 1000];
            }
        }
        if ($conflicts !== []) {
            throw new AnnotationOverlapException($conflicts);
        }
    }
}
