<?php

namespace App\Http\Controllers;

use App\Models\ApplicationDocument;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response as HttpResponse;

/**
 * STEP-12-FROZEN-CONTRACT.md §5. The ONLY route in this codebase that
 * serves an `application_documents` file — reached exclusively via a
 * short-lived signed URL from App\Services\ApplicationDocumentUrlSigner,
 * generated only from an authorized admin action (the Filament
 * coach-application review page), never a public/guessable path.
 *
 * Downloadable rows only (`ApplicationDocument::isDownloadable()`): `clean`
 * with a non-empty path. An `infected` row's bytes have already been purged
 * by App\Jobs\ScanApplicationDocument, a `pending_scan` row must not be
 * openable before the scan has run, and purged or erased rows keep `clean`
 * with `path = ''`. `fileExists`, not `exists`: `exists('')` is true for the
 * disk root directory, which made a purged row a 500 in `download()`
 * (PLAN-COACH-APPLICATION-REVIEW-PAGE.md §6).
 *
 * Same origin as the panel: the route lives in `routes/web.php` on
 * `APP_URL`, which is also the admin panel's own high-privilege, cookie-
 * bearing origin — there is no separate media origin here. Three headers
 * keep a PDF ("a scripting environment" per STEP-12.md's "Watch for")
 * from running there: `Content-Disposition: attachment` (never `inline`)
 * makes the browser download it instead of rendering it, `nosniff` stops
 * content sniffing, and `Content-Security-Policy: sandbox` (the third
 * header MODERNIZATION_PLAN.md:1134 requires for the cookie origin) gives
 * it an opaque origin if anything does render it. A cookieless download
 * host is the real fix and is deliberately deferred (plan §14).
 */
class ApplicationDocumentDownloadController extends Controller
{
    public function show(Request $request, ApplicationDocument $document): HttpResponse
    {
        abort_unless($request->hasValidSignature(), Response::HTTP_FORBIDDEN);
        abort_unless($document->isDownloadable(), Response::HTTP_NOT_FOUND);
        abort_unless(Storage::disk($document->disk)->fileExists($document->path), Response::HTTP_NOT_FOUND);

        return Storage::disk($document->disk)->download(
            $document->path,
            $document->original_filename,
            [
                'Content-Type' => 'application/pdf',
                'X-Content-Type-Options' => 'nosniff',
                'Content-Security-Policy' => 'sandbox',
            ],
        );
    }
}
