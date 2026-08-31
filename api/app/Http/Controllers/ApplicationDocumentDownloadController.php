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
 * `clean` documents only — an `infected` row's storage bytes have already
 * been purged by App\Jobs\ScanApplicationDocument, and a `pending_scan`
 * row must not be openable before the scan has had a chance to run.
 *
 * This is the first place in the codebase setting `Content-Disposition:
 * attachment` and `X-Content-Type-Options: nosniff` at all (confirmed by
 * repo-wide grep, STEP-12-FROZEN-CONTRACT.md §5) — there is nothing to
 * copy; built directly from the contract's non-negotiables. Forcing
 * `attachment` (never `inline`) is what keeps a PDF — "a scripting
 * environment" per STEP-12.md's "Watch for" section — from ever executing
 * in the admin panel's own high-privilege origin: the browser downloads
 * it instead of rendering it as a page.
 */
class ApplicationDocumentDownloadController extends Controller
{
    public function show(Request $request, ApplicationDocument $document): HttpResponse
    {
        abort_unless($request->hasValidSignature(), Response::HTTP_FORBIDDEN);
        abort_unless($document->status === 'clean', Response::HTTP_NOT_FOUND);
        abort_unless(Storage::disk($document->disk)->exists($document->path), Response::HTTP_NOT_FOUND);

        return Storage::disk($document->disk)->download(
            $document->path,
            $document->original_filename,
            [
                'Content-Type' => 'application/pdf',
                'X-Content-Type-Options' => 'nosniff',
            ],
        );
    }
}
