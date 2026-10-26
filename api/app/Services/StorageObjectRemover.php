<?php

namespace App\Services;

use Illuminate\Support\Facades\Storage;
use RuntimeException;

/** Delete only object paths already selected and claimed by the caller. */
class StorageObjectRemover
{
    /** @param list<string> $paths */
    public function deleteExisting(string $disk, array $paths, string $failureMessage): void
    {
        foreach ($paths as $path) {
            if (Storage::disk($disk)->exists($path) && ! Storage::disk($disk)->delete($path)) {
                throw new RuntimeException($failureMessage);
            }
        }
    }
}
