<?php

namespace App\Services\Essay;

/**
 * The frozen STEP-08 backend contract's `EssayRenderer` seam: a pure value
 * object for whatever a future renderer (e.g. the PDF export the plan
 * explicitly defers — STEP-08-essay.md's "Deliberately stubbed" section)
 * would need to know beyond the `Review` itself. Empty today, on purpose —
 * nothing in this step calls `EssayRenderer::render()` at all, so there is
 * no real option to model yet. Add fields only when a real caller needs
 * them, not speculatively.
 */
class EssayRenderOptions {}
