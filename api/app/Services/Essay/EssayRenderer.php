<?php

namespace App\Services\Essay;

use App\Models\Review;

/**
 * The frozen STEP-08 backend contract: a pure interface, unused by any
 * endpoint in this step. It exists only so the seam is real, per the plan's
 * "make the expensive decisions now" reasoning — the same "adapter seam"
 * shape as `App\Services\Transcoding\TranscoderContract`, bound in
 * `AppServiceProvider::register()` to `NullEssayRenderer` for every
 * environment until a real implementation (e.g. the PDF export STEP-08
 * explicitly defers) replaces the binding.
 */
interface EssayRenderer
{
    public function render(Review $review, EssayRenderOptions $options): string;
}
