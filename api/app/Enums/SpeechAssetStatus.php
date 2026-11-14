<?php

namespace App\Enums;

/**
 * Every value the `ck_speech_assets_status` CHECK allows, in CHECK order
 * (2026_08_18_110001_enable_voice_note_assets.php:48). Values only:
 * `SpeechAsset::$status` stays a plain string (no cast), so compare and
 * write `->value`. MODERNIZATION_PLAN §9.4 rule 3: status is the only
 * playback-readiness signal.
 */
enum SpeechAssetStatus: string
{
    case Uploading = 'uploading';
    case Processing = 'processing';
    case Ready = 'ready';
    case Failed = 'failed';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $status): string => $status->value, self::cases());
    }
}
