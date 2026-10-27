<?php

use App\Jobs\ScanApplicationDocument;
use App\Models\ApplicationDocument;
use App\Services\ApplicationDocumentWork;
use App\Services\StorageObjectRemover;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;

require_once __DIR__.'/DocumentWorkHelpers.php';

function runScanJob(ApplicationDocument $document, $scanner): void
{
    (new ScanApplicationDocument($document->id))->handle($scanner, app(ApplicationDocumentWork::class));
}

it('declares the R6 worker budget', function () {
    $job = new ScanApplicationDocument(1);

    expect($job->timeout)->toBe(60)
        ->and($job->tries)->toBe(1)
        ->and($job->failOnTimeout)->toBeTrue();
});

it('flips a document to clean when the scanner reports clean', function () {
    $document = workDocument();

    runScanJob($document, fakeScanner(true));

    $fresh = $document->fresh();
    expect($fresh->status)->toBe('clean')
        ->and($fresh->work_claim_id)->toBeNull()
        ->and($fresh->work_lease_until)->toBeNull()
        ->and($fresh->path)->toBe($document->path);
    expect(Storage::disk('application_documents')->exists($document->path))->toBeTrue();
});

it('commits infected before cleanup and then purges the bytes when cleanup is woken', function () {
    $document = workDocument();

    runScanJob($document, fakeScanner(false)); // sync queue: cleanup delivery runs inline

    $fresh = $document->fresh();
    expect($fresh->status)->toBe('infected')
        ->and($fresh->path)->toBe('')
        ->and($fresh->sha256)->toBe(str_repeat('a', 64))
        ->and($fresh->work_claim_id)->toBeNull();
    expect(Storage::disk('application_documents')->exists($document->path))->toBeFalse();
});

it('keeps the infected verdict when the cleanup wakeup cannot be queued', function () {
    $document = workDocument();
    app()->bind(ApplicationDocumentWork::class, fn () => new class(new StorageObjectRemover) extends ApplicationDocumentWork
    {
        public function ensureQueued(int $documentId): bool
        {
            throw new RuntimeException('redis down');
        }
    });

    runScanJob($document, fakeScanner(false));

    $fresh = $document->fresh();
    expect($fresh->status)->toBe('infected')
        ->and($fresh->path)->toBe($document->path)
        ->and($fresh->work_attempts)->toBe(0)
        ->and($fresh->work_next_attempt_at)->not->toBeNull()
        ->and($fresh->work_dispatched_at)->toBeNull();
});

it('does not inline the cleanup: infected redelivery cleans only and never rescans', function () {
    Queue::fake();
    $document = workDocument();
    runScanJob($document, fakeScanner(false));
    Queue::assertPushed(ScanApplicationDocument::class, 1);
    expect(Storage::disk('application_documents')->exists($document->path))->toBeTrue();

    $scanner = fakeScanner(true);
    runScanJob($document, $scanner);

    expect($scanner->calls)->toBe(0)
        ->and($document->fresh()->status)->toBe('infected')
        ->and($document->fresh()->path)->toBe('');
    expect(Storage::disk('application_documents')->exists($document->path))->toBeFalse();
});

it('retains the path and spends budget when the delete returns false', function () {
    Queue::fake();
    $document = workDocument(['status' => 'infected']);
    fakeRemover('false');

    expect(fn () => runScanJob($document, fakeScanner(true)))->toThrow(RuntimeException::class);

    $fresh = $document->fresh();
    expect($fresh->status)->toBe('infected')
        ->and($fresh->path)->toBe($document->path)
        ->and($fresh->work_attempts)->toBe(1)
        ->and($fresh->work_claim_id)->toBeNull()
        ->and($fresh->work_lease_until)->toBeNull()
        ->and($fresh->work_next_attempt_at->isFuture())->toBeTrue();
});

it('retains the path when the delete throws', function () {
    $document = workDocument(['status' => 'infected']);
    fakeRemover('throw');

    expect(fn () => runScanJob($document, fakeScanner(true)))->toThrow(RuntimeException::class, 'boom');

    expect($document->fresh()->path)->toBe($document->path)
        ->and($document->fresh()->work_attempts)->toBe(1);
});

it('treats an already-missing object as cleanup success', function () {
    $document = workDocument(['status' => 'infected'], withBytes: false);

    runScanJob($document, fakeScanner(true));

    expect($document->fresh()->path)->toBe('')
        ->and($document->fresh()->status)->toBe('infected');
});

it('never passes an empty path to the remover', function () {
    $infected = workDocument(['status' => 'infected', 'path' => '']);
    $pending = workDocument(['status' => 'pending_scan', 'path' => '']);
    $remover = fakeRemover();
    $scanner = fakeScanner(true);

    runScanJob($infected, $scanner);
    runScanJob($pending, $scanner);

    expect($remover->calls)->toBe([])
        ->and($scanner->calls)->toBe(0)
        ->and($pending->fresh()->status)->toBe('pending_scan')
        ->and($pending->fresh()->work_attempts)->toBe(0)
        ->and($infected->fresh()->work_attempts)->toBe(0);
});

it('does a missing-document delivery quietly and ignores clean rows', function () {
    $scanner = fakeScanner(false);
    (new ScanApplicationDocument(999999))->handle($scanner, app(ApplicationDocumentWork::class));
    $clean = workDocument(['status' => 'clean']);

    runScanJob($clean, $scanner);

    expect($scanner->calls)->toBe(0)->and($clean->fresh()->work_attempts)->toBe(0);
});

it('does not adopt a stale clean verdict after retention cleared the path', function () {
    $document = workDocument();
    $scanner = fakeScanner(function () use ($document) {
        ApplicationDocument::query()->whereKey($document->id)->update(['path' => '']);

        return true;
    });

    runScanJob($document, $scanner);

    $fresh = $document->fresh();
    expect($fresh->status)->toBe('pending_scan')->and($fresh->path)->toBe('');
});

it('does not adopt a stale clean verdict when the stored hash changed', function () {
    $document = workDocument();
    $scanner = fakeScanner(function () use ($document) {
        ApplicationDocument::query()->whereKey($document->id)->update(['sha256' => str_repeat('b', 64)]);

        return true;
    });

    runScanJob($document, $scanner);

    expect($document->fresh()->status)->toBe('pending_scan');
});

it('lets a stale clean result never overwrite an infected row or restore its path', function () {
    Queue::fake();
    $document = workDocument();
    $scanner = fakeScanner(function () use ($document) {
        ApplicationDocument::query()->whereKey($document->id)->update(['status' => 'infected', 'path' => '']);

        return true;
    });

    runScanJob($document, $scanner);

    expect($document->fresh()->status)->toBe('infected')->and($document->fresh()->path)->toBe('');
});

it('releases the claim, schedules a retry and rethrows when the scanner throws', function () {
    $document = workDocument();
    $scanner = fakeScanner(fn () => throw new RuntimeException('clamd down'));

    expect(fn () => runScanJob($document, $scanner))->toThrow(RuntimeException::class, 'clamd down');

    $fresh = $document->fresh();
    expect($fresh->status)->toBe('pending_scan')
        ->and($fresh->work_attempts)->toBe(1)
        ->and($fresh->work_claim_id)->toBeNull()
        ->and($fresh->work_lease_until)->toBeNull()
        ->and($fresh->work_next_attempt_at->between(now()->addSeconds(55), now()->addSeconds(65)))->toBeTrue();
});

it('keeps a missing pending object pending and spends an attempt', function () {
    $document = workDocument(withBytes: false);

    runScanJob($document, fakeScanner(true));

    $fresh = $document->fresh();
    expect($fresh->status)->toBe('pending_scan')->and($fresh->work_attempts)->toBe(1)->and($fresh->work_claim_id)->toBeNull();
});
