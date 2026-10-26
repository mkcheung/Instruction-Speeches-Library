<?php

namespace App\Support;

use InvalidArgumentException;

/** One operation's exact local paths; callers dispose them in an explicit finally. */
class ScratchFiles
{
    /** @var list<string> */
    private array $paths = [];

    public function create(string $prefix, string $suffix = ''): string
    {
        if ($suffix !== '' && preg_match('/^\.[a-z0-9]+$/iD', $suffix) !== 1) {
            throw new InvalidArgumentException('A scratch suffix must be a file extension.');
        }
        $base = $this->allocate($prefix);
        if ($base === false) {
            throw new ScratchFileAllocationException;
        }
        if ($suffix === '') {
            $this->paths[] = $base;

            return $base;
        }
        $path = $base.$suffix;
        $this->paths[] = $path;
        // Once released, the placeholder name may be reallocated by another
        // worker's tempnam(); cleanup must not unlink a name this scope no
        // longer owns. Track it only if the release itself failed.
        if (! @unlink($base)) {
            $this->paths[] = $base;
        }

        return $path;
    }

    protected function allocate(string $prefix): string|false
    {
        return @tempnam(sys_get_temp_dir(), $prefix);
    }

    public function cleanup(): void
    {
        foreach ($this->paths as $path) {
            @unlink($path);
        }
        $this->paths = [];
    }
}
