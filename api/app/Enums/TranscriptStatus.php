<?php

namespace App\Enums;

/**
 * Every value the `ck_annotations_transcript_status` CHECK allows, in CHECK
 * order (2026_08_18_110002_add_voice_audio_to_annotations.php:28). Values
 * only: compare and write `->value`.
 */
enum TranscriptStatus: string
{
    case NotApplicable = 'not_applicable';
    case Pending = 'pending';
    case Processing = 'processing';
    case Ready = 'ready';
    case Failed = 'failed';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $status): string => $status->value, self::cases());
    }

    /**
     * Attempts a worker may still finish: the states a failure settles.
     *
     * @return list<string>
     */
    public static function inFlight(): array
    {
        return [self::Pending->value, self::Processing->value];
    }
}
