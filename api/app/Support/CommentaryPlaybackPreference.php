<?php

namespace App\Support;

final class CommentaryPlaybackPreference
{
    public const MODES = ['all', 'written', 'voice', 'off'];

    /**
     * @param  array<string, mixed>|null  $preferences
     * @return array{speech_id: int, mode: string, source: string, legacy_mode?: string}
     */
    public static function resolve(?array $preferences, int $speechId): array
    {
        $preferences ??= [];
        foreach (['commentary_playback', 'voice_commentary'] as $namespace) {
            if (! array_key_exists($namespace, $preferences)) {
                continue;
            }
            $entries = $preferences[$namespace];
            if (! is_array($entries)) {
                return ['speech_id' => $speechId, 'mode' => 'off', 'source' => 'invalid'];
            }
            if (! array_key_exists($speechId, $entries)) {
                continue;
            }
            $entry = $entries[$speechId];
            $mode = is_array($entry) ? ($entry['mode'] ?? null) : null;
            if ($namespace === 'commentary_playback') {
                return in_array($mode, self::MODES, true)
                    ? ['speech_id' => $speechId, 'mode' => $mode, 'source' => 'saved']
                    : ['speech_id' => $speechId, 'mode' => 'off', 'source' => 'invalid'];
            }
            $mapped = match ($mode) {
                'play' => 'all',
                'none', 'text' => 'written',
                default => null,
            };

            return $mapped === null
                ? ['speech_id' => $speechId, 'mode' => 'off', 'source' => 'invalid']
                : ['speech_id' => $speechId, 'mode' => $mapped, 'source' => 'legacy', 'legacy_mode' => $mode];
        }

        return ['speech_id' => $speechId, 'mode' => 'all', 'source' => 'default'];
    }
}
