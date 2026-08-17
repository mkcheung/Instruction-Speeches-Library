<?php

namespace App\Services\Essay;

use App\Models\Review;
use RuntimeException;

/**
 * The only binding for `EssayRenderer` today (see
 * `AppServiceProvider::register()`) — nothing in STEP-08 calls
 * `render()`, so this deliberately throws rather than returning a fake
 * value that would silently paper over a caller added before a real
 * renderer exists. No `NotImplemented` exception class exists yet in this
 * codebase (checked before writing this), so this uses a plain
 * `RuntimeException` with a clear message, per the frozen contract's own
 * fallback instruction.
 */
class NullEssayRenderer implements EssayRenderer
{
    public function render(Review $review, EssayRenderOptions $options): string
    {
        throw new RuntimeException('EssayRenderer is not implemented yet — this seam exists for a future step (e.g. PDF export).');
    }
}
