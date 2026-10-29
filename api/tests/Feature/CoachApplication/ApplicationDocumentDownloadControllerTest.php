<?php

use App\Models\ApplicationDocument;
use App\Services\ApplicationDocumentUrlSigner;
use Illuminate\Support\Carbon;

require_once __DIR__.'/DocumentWorkHelpers.php';

/*
 * PLAN-COACH-APPLICATION-REVIEW-PAGE.md §11 test 8 / §6. `workDocument()`
 * calls `Storage::fake('application_documents')` and writes the bytes.
 */

afterEach(fn () => Carbon::setTestNow());

function signedDocumentUrl(ApplicationDocument $document, int $ttlSeconds = 60): string
{
    return app(ApplicationDocumentUrlSigner::class)->presign($document, $ttlSeconds);
}

it('rejects an unsigned URL with 403', function () {
    $document = workDocument(['status' => 'clean']);

    $this->get(route('admin.application-documents.show', ['document' => $document->id]))
        ->assertForbidden();
});

it('rejects a tampered URL with 403', function () {
    $document = workDocument(['status' => 'clean']);
    $other = workDocument(['status' => 'clean']);

    $tampered = str_replace(
        '/application-documents/'.$document->id.'?',
        '/application-documents/'.$other->id.'?',
        signedDocumentUrl($document),
    );

    $this->get($tampered)->assertForbidden();
});

it('rejects an expired URL with 403', function () {
    $document = workDocument(['status' => 'clean']);
    $url = signedDocumentUrl($document, 60);

    Carbon::setTestNow(now()->addSeconds(61));

    $this->get($url)->assertForbidden();
});

it('404s a document that is not downloadable', function (array $overrides) {
    $document = workDocument($overrides);

    $this->get(signedDocumentUrl($document))->assertNotFound();
})->with([
    'pending scan' => [['status' => 'pending_scan']],
    'infected' => [['status' => 'infected']],
    // Was a 500: exists('') is true for the disk root, then download('') throws.
    'retention-purged' => [['status' => 'clean', 'path' => '']],
    'erased' => [['status' => 'clean', 'path' => '', 'original_filename' => ApplicationDocument::ERASED_FILENAME]],
]);

it('404s a clean document whose bytes are gone', function () {
    $document = workDocument(['status' => 'clean'], withBytes: false);

    $this->get(signedDocumentUrl($document))->assertNotFound();
});

it('serves a clean document as a sandboxed, non-sniffable PDF attachment', function () {
    $document = workDocument(['status' => 'clean', 'original_filename' => 'certificate.pdf']);

    $response = $this->get(signedDocumentUrl($document))->assertOk();

    expect($response->headers->get('Content-Disposition'))->toStartWith('attachment')
        ->toContain('certificate.pdf')
        ->and($response->headers->get('Content-Type'))->toBe('application/pdf')
        ->and($response->headers->get('X-Content-Type-Options'))->toBe('nosniff')
        ->and($response->headers->get('Content-Security-Policy'))->toBe('sandbox')
        ->and($response->streamedContent())->toBe('%PDF-1.4 fake');
});
