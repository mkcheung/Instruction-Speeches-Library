<?php

namespace App\Services;

use Illuminate\Support\Facades\Storage;

/** Streams one remote input into a caller-owned local file without buffering it. */
class MediaInputCopier
{
    public function copy(string $disk, string $remotePath, string $localPath, int $expectedBytes = 0): bool
    {
        $source = Storage::disk($disk)->readStream($remotePath);
        if ($source === null) {
            return false;
        }
        $destination = null;
        try {
            $destination = @fopen($localPath, 'wb');
            if ($destination === false) {
                return false;
            }
            $copied = stream_copy_to_stream($source, $destination);

            return $copied !== false && ($expectedBytes <= 0 || $copied === $expectedBytes);
        } finally {
            if (is_resource($destination)) {
                fclose($destination);
            }
            fclose($source);
        }
    }
}
