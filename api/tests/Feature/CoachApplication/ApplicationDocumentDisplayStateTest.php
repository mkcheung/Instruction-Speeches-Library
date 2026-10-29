<?php

use App\Models\ApplicationDocument;
use App\Services\ApplicationDocumentWork;

require_once __DIR__.'/DocumentWorkHelpers.php';

/*
 * PLAN-COACH-APPLICATION-REVIEW-PAGE.md §11 test 7: every row of the §2.5
 * document-state table, plus whether it is downloadable. Overrides are
 * closures so `now()` is read inside the test, not at dataset collection.
 */
it('maps each stored document state to its display state and downloadability', function (Closure $overrides, string $state, bool $downloadable) {
    $document = workDocument($overrides());

    expect($document->displayState())->toBe($state)
        ->and($document->isDownloadable())->toBe($downloadable);
})->with([
    'erased' => [fn () => ['status' => 'clean', 'path' => '', 'original_filename' => ApplicationDocument::ERASED_FILENAME], 'Erased', false],
    'infected with bytes' => [fn () => ['status' => 'infected'], 'Quarantined', false],
    'infected, bytes purged' => [fn () => ['status' => 'infected', 'path' => ''], 'Quarantined', false],
    'retention-purged clean row' => [fn () => ['status' => 'clean', 'path' => ''], 'Purged', false],
    'clean' => [fn () => ['status' => 'clean'], 'Clean', true],
    'clean upload literally named [erased]' => [fn () => ['status' => 'clean', 'original_filename' => ApplicationDocument::ERASED_FILENAME], 'Clean', true],
    'scan attempts exhausted, no lease' => [fn () => ['work_attempts' => ApplicationDocumentWork::MAX_STARTS], 'Scan failed', false],
    'scan attempts exhausted, lease expired' => [fn () => ['work_attempts' => ApplicationDocumentWork::MAX_STARTS, 'work_lease_until' => now()->subSecond()], 'Scan failed', false],
    'third attempt in flight (live lease)' => [fn () => ['work_attempts' => ApplicationDocumentWork::MAX_STARTS, 'work_lease_until' => now()->addMinute()], 'Scanning', false],
    'pending, never attempted' => [fn () => [], 'Scanning', false],
    'pending, attempts remaining' => [fn () => ['work_attempts' => ApplicationDocumentWork::MAX_STARTS - 1], 'Scanning', false],
]);

it('orders documentsForReview by id, the position the review page resolves rows by', function () {
    $first = workDocument(['status' => 'clean']);
    $application = $first->application;
    $second = new ApplicationDocument;
    $second->forceFill([
        'application_id' => $application->id,
        'disk' => 'application_documents',
        'path' => 'applications/'.$application->id.'/second.pdf',
        'original_filename' => 'second.pdf',
        'byte_size' => 10,
        'status' => 'pending_scan',
    ])->save();

    // Touch the first row so a heap-ordered engine could return it last.
    $first->forceFill(['status' => 'infected'])->save();

    expect($application->documentsForReview()->toBase()->orders)->toBe([['column' => 'id', 'direction' => 'asc']])
        ->and($application->documentsForReview->pluck('id')->all())->toBe([$first->id, $second->id]);
});
