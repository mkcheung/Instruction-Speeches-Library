<?php

namespace App\Services\Search;

use LogicException;

/**
 * Positions come from the database's LOWER strings, never PHP case folding.
 * Supported database locales must preserve codepoint positions when lowering;
 * fail explicitly if a different locale violates that validated contract.
 */
class SearchTextMatcher
{
    public const EXCERPT_LENGTH = 360;

    /** @return list<array{text: string, matched: bool}> */
    public function parts(string $original, string $lowered, string $needle): array
    {
        $this->assertPositions($original, $lowered, $needle);
        $parts = [];
        $cursor = 0;
        $length = mb_strlen($needle, 'UTF-8');
        while (($position = mb_strpos($lowered, $needle, $cursor, 'UTF-8')) !== false) {
            if ($position > $cursor) {
                $parts[] = ['text' => mb_substr($original, $cursor, $position - $cursor, 'UTF-8'), 'matched' => false];
            }
            $parts[] = ['text' => mb_substr($original, $position, $length, 'UTF-8'), 'matched' => true];
            $cursor = $position + $length;
        }
        if ($cursor < mb_strlen($original, 'UTF-8')) {
            $parts[] = ['text' => mb_substr($original, $cursor, null, 'UTF-8'), 'matched' => false];
        }

        return $parts;
    }

    /** @return array{parts: list<array{text: string, matched: bool}>, truncated_before: bool, truncated_after: bool}|null */
    public function excerpt(string $original, string $lowered, string $needle): ?array
    {
        $this->assertPositions($original, $lowered, $needle);
        $position = mb_strpos($lowered, $needle, 0, 'UTF-8');
        if ($position === false) {
            return null;
        }
        $sourceLength = mb_strlen($original, 'UTF-8');
        $context = max(0, self::EXCERPT_LENGTH - mb_strlen($needle, 'UTF-8'));
        $start = max(0, $position - intdiv($context, 2));
        $end = min($sourceLength, $start + self::EXCERPT_LENGTH);
        $start = max(0, $end - self::EXCERPT_LENGTH);

        return [
            'parts' => $this->parts(
                mb_substr($original, $start, $end - $start, 'UTF-8'),
                mb_substr($lowered, $start, $end - $start, 'UTF-8'),
                $needle,
            ),
            'truncated_before' => $start > 0,
            'truncated_after' => $end < $sourceLength,
        ];
    }

    private function assertPositions(string $original, string $lowered, string $needle): void
    {
        if ($needle === '' || mb_strlen($original, 'UTF-8') !== mb_strlen($lowered, 'UTF-8')) {
            throw new LogicException('Search requires a nonempty query and position-preserving database lowercase mapping.');
        }
    }
}
