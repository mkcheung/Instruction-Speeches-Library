<?php

namespace App\Services;

/**
 * STEP-12-FROZEN-CONTRACT.md §5: sha256 + magic-byte validation do not
 * exist anywhere else in this codebase — built from scratch here, not
 * copied from `SpeechUploadController` (which only does randomized-path
 * keys, no content validation).
 *
 * Page count is read directly off the raw PDF byte stream (regex over
 * `/Type /Pages ... /Count N`) rather than shelling out to a full-page-
 * render tool or pulling in a heavy PDF-parsing dependency, per the
 * frozen contract's "a lightweight PHP PDF page-counter... don't add a
 * heavy dependency for this." This is deliberately best-effort: an
 * uncompressed/xref-stream-free PDF (the overwhelming majority produced
 * by ordinary export tools) exposes `/Type/Pages` with a plain `/Count`
 * integer in cleartext; a PDF using compressed object streams may not
 * match, in which case `pageCount()` returns null and the caller treats
 * that as "could not verify" rather than a hard reject — this validator's
 * job is a defensive size/type check, not a full PDF parser.
 */
class PdfUploadValidator
{
    public const MAX_BYTES = 10 * 1024 * 1024;

    public const MAX_PAGES = 30;

    public function hasPdfMagicBytes(string $absolutePath): bool
    {
        $handle = fopen($absolutePath, 'rb');
        if ($handle === false) {
            return false;
        }

        try {
            $header = fread($handle, 5);

            return $header === '%PDF-';
        } finally {
            fclose($handle);
        }
    }

    public function sha256(string $absolutePath): string
    {
        return hash_file('sha256', $absolutePath);
    }

    /**
     * Best-effort page count, or null if it could not be determined from
     * a direct byte scan (see class docblock). Callers should reject on a
     * count that WAS determined and exceeds `MAX_PAGES`, but not reject
     * solely because the count could not be determined.
     */
    public function pageCount(string $absolutePath): ?int
    {
        $contents = @file_get_contents($absolutePath);
        if ($contents === false) {
            return null;
        }

        // `/Type /Pages ... /Count 12` — tolerant of the slash/space
        // variations real PDF producers emit.
        if (preg_match('/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/s', $contents, $matches) === 1) {
            return (int) $matches[1];
        }

        // Fallback: count `/Type /Page` (singular, not `/Pages`) object
        // occurrences — a weaker signal (can overcount if a producer
        // repeats the token in a stream), used only when the Pages-tree
        // Count above wasn't found.
        $count = preg_match_all('/\/Type\s*\/Page(?!s)\b/', $contents);

        return $count > 0 ? $count : null;
    }
}
