<?php

namespace App\Services\Captions;

use RuntimeException;

/**
 * Thrown internally by WhisperTranscriber when `Storage::put()` for the
 * generated VTT returns `false` (a write failure the disk driver doesn't
 * otherwise surface). Caught inside `transcribe()` to roll back the
 * guarded `DB::transaction()` (so the asset row is never flipped to
 * `ready` over a VTT that didn't actually land on disk) and resolved to
 * the same user-safe `failed` status every other failure path in this
 * class uses — never allowed to escape `transcribe()` itself, matching
 * the class's own never-throw contract.
 */
class CaptionStorageWriteException extends RuntimeException {}
