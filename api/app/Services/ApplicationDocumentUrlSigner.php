<?php

namespace App\Services;

use App\Models\ApplicationDocument;
use Illuminate\Support\Facades\URL;

/**
 * STEP-12-FROZEN-CONTRACT.md §5. The `application_documents` disk is
 * local/private (config/filesystems.php) — there is no bucket-level
 * presigned GET to hand out the way `MediaUrlSigner` does for `media`.
 * Instead this signs a Laravel route
 * (`App\Http\Controllers\ApplicationDocumentDownloadController`) with
 * Laravel's own `signed` middleware, short-lived, and that controller is
 * the one place `Content-Disposition: attachment` +
 * `X-Content-Type-Options: nosniff` get forced onto the response — never
 * inline, per STEP-12.md's "Watch for" non-negotiables.
 */
class ApplicationDocumentUrlSigner
{
    public const DEFAULT_TTL_SECONDS = 300;

    public function presign(ApplicationDocument $document, int $ttlSeconds = self::DEFAULT_TTL_SECONDS): string
    {
        return URL::temporarySignedRoute(
            'admin.application-documents.show',
            now()->addSeconds($ttlSeconds),
            ['document' => $document->id],
        );
    }
}
