<?php

use App\Jobs\ScanApplicationDocument;
use App\Models\ApplicationDocument;
use App\Services\ApplicationDocumentWork;
use Illuminate\Contracts\Bus\Dispatcher;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;

require_once __DIR__.'/DocumentWorkHelpers.php';

afterEach(fn () => Carbon::setTestNow());

it('enqueues eligible pending and infected documents with the id only, recording the attempt time', function () {
    Queue::fake();
    $pending = workDocument();
    $infected = workDocument(['status' => 'infected']);
    $work = app(ApplicationDocumentWork::class);

    expect($work->ensureQueued($pending->id))->toBeTrue()
        ->and($work->ensureQueued($infected->id))->toBeTrue();

    Queue::assertPushed(ScanApplicationDocument::class, 2);
    Queue::assertPushed(ScanApplicationDocument::class, fn ($job) => $job->documentId === $pending->id);
    $fresh = $pending->fresh();
    expect($fresh->work_dispatched_at)->not->toBeNull()
        ->and($fresh->work_attempts)->toBe(0)
        ->and($fresh->work_claim_id)->toBeNull()
        ->and($fresh->work_lease_until)->toBeNull();
});

it('throttles wakeups to five minutes', function () {
    Queue::fake();
    Carbon::setTestNow('2026-10-26 10:00:00');
    $document = workDocument();
    $work = app(ApplicationDocumentWork::class);

    expect($work->ensureQueued($document->id))->toBeTrue()
        ->and($work->ensureQueued($document->id))->toBeFalse();
    Carbon::setTestNow('2026-10-26 10:04:59');
    expect($work->ensureQueued($document->id))->toBeFalse();
    Carbon::setTestNow('2026-10-26 10:05:01');
    expect($work->ensureQueued($document->id))->toBeTrue();
    Queue::assertPushed(ScanApplicationDocument::class, 2);
});

it('does not enqueue ineligible rows', function (array $overrides, bool $bytes) {
    Queue::fake();
    Carbon::setTestNow('2026-10-26 10:00:00');
    $document = workDocument($overrides, $bytes);

    expect(app(ApplicationDocumentWork::class)->ensureQueued($document->id))->toBeFalse();
    Queue::assertNothingPushed();
})->with([
    'clean' => [['status' => 'clean'], true],
    'empty pending path' => [['path' => ''], false],
    'cleared infected path' => [['status' => 'infected', 'path' => ''], false],
    'exhausted' => [['work_attempts' => 3], true],
    'not yet due' => [['work_next_attempt_at' => '2026-10-26 10:01:00'], true],
    'active lease' => [['work_lease_until' => '2026-10-26 10:00:30'], true],
]);

it('returns false for a missing document', function () {
    Queue::fake();
    expect(app(ApplicationDocumentWork::class)->ensureQueued(424242))->toBeFalse();
});

it('enqueues again once a lease has expired', function () {
    Queue::fake();
    $document = workDocument(['work_lease_until' => now()->subSecond()]);

    expect(app(ApplicationDocumentWork::class)->ensureQueued($document->id))->toBeTrue();
});

it('keeps durable intent when the push fails and does not throw', function () {
    $this->app->instance(Dispatcher::class, Mockery::mock(Dispatcher::class, fn ($m) => $m->shouldReceive('dispatch')->andThrow(new RuntimeException('redis down'))));
    $document = workDocument();

    expect(app(ApplicationDocumentWork::class)->ensureQueued($document->id))->toBeFalse();

    $fresh = $document->fresh();
    expect($fresh->status)->toBe('pending_scan')->and($fresh->work_dispatched_at)->not->toBeNull()->and($fresh->work_attempts)->toBe(0);
});

it('spends no attempt on a delivery blocked by an active lease', function () {
    $document = workDocument(['work_lease_until' => now()->addSeconds(40), 'work_claim_id' => 'c0000000-0000-4000-8000-000000000000', 'work_attempts' => 1]);
    $scanner = fakeScanner(true);

    app(ApplicationDocumentWork::class)->process($document->id, $scanner);

    expect($scanner->calls)->toBe(0)->and($document->fresh()->work_attempts)->toBe(1);
});

it('claims with a 75 second lease and conservative next eligibility', function () {
    Carbon::setTestNow('2026-10-26 10:00:00');
    $document = workDocument();
    $seen = null;
    $scanner = fakeScanner(function () use ($document, &$seen) {
        $seen = ApplicationDocument::query()->find($document->id);

        return true;
    });

    app(ApplicationDocumentWork::class)->process($document->id, $scanner);

    expect($seen->work_attempts)->toBe(1)
        ->and($seen->work_claim_id)->not->toBeNull()
        ->and($seen->work_lease_until->toDateTimeString())->toBe('2026-10-26 10:01:15')
        ->and($seen->work_next_attempt_at->toDateTimeString())->toBe('2026-10-26 10:02:15');
});

it('allows three starts per phase with 60 then 300 second backoff, then exhausts', function () {
    Carbon::setTestNow('2026-10-26 10:00:00');
    $document = workDocument();
    $work = app(ApplicationDocumentWork::class);
    $scanner = fakeScanner(fn () => throw new RuntimeException('down'));

    foreach ([60, 300] as $i => $delay) {
        expect(fn () => $work->process($document->id, $scanner))->toThrow(RuntimeException::class);
        $fresh = $document->fresh();
        expect($fresh->work_attempts)->toBe($i + 1)
            ->and($fresh->work_next_attempt_at->toDateTimeString())->toBe(now()->addSeconds($delay)->toDateTimeString());

        // Not due yet: no work, no budget spent.
        $before = $scanner->calls;
        $work->process($document->id, $scanner);
        expect($scanner->calls)->toBe($before)->and($document->fresh()->work_attempts)->toBe($i + 1);

        Carbon::setTestNow(now()->addSeconds($delay + 1));
    }

    expect(fn () => $work->process($document->id, $scanner))->toThrow(RuntimeException::class);
    $fresh = $document->fresh();
    expect($fresh->work_attempts)->toBe(3)
        ->and($fresh->work_next_attempt_at)->toBeNull()
        ->and($fresh->status)->toBe('pending_scan')
        ->and($fresh->path)->toBe($document->path);

    Carbon::setTestNow(now()->addDay());
    $calls = $scanner->calls;
    $work->process($document->id, $scanner);
    expect($scanner->calls)->toBe($calls);
    Queue::fake();
    expect($work->ensureQueued($document->id))->toBeFalse();
});

it('a crash cannot cause an immediate retry: claim alone blocks until lease plus delay', function () {
    Carbon::setTestNow('2026-10-26 10:00:00');
    $document = workDocument();
    $work = app(ApplicationDocumentWork::class);
    // A killed worker: claimed (attempt 1, lease 75s, next = lease + 60s), never finalized.
    $scanner = fakeScanner(true);
    ApplicationDocument::query()->whereKey($document->id)->update([
        'work_claim_id' => 'c0000000-0000-4000-8000-000000000000',
        'work_lease_until' => now()->addSeconds(75),
        'work_next_attempt_at' => now()->addSeconds(135),
        'work_attempts' => 1,
    ]);

    Carbon::setTestNow('2026-10-26 10:01:00');
    $calls = $scanner->calls;
    $work->process($document->id, $scanner);
    Carbon::setTestNow('2026-10-26 10:02:00'); // lease over, not yet due
    $work->process($document->id, $scanner);

    expect($scanner->calls)->toBe($calls);
});

it('resets the attempt counter for the cleanup phase after a negative scan', function () {
    Queue::fake();
    $document = workDocument(['work_attempts' => 2, 'work_next_attempt_at' => now()->subMinute()]);

    app(ApplicationDocumentWork::class)->process($document->id, fakeScanner(false));

    $fresh = $document->fresh();
    expect($fresh->status)->toBe('infected')
        ->and($fresh->work_attempts)->toBe(0)
        ->and($fresh->work_next_attempt_at->lte(now()))->toBeTrue()
        ->and($fresh->work_dispatched_at)->not->toBeNull(); // re-set by the cleanup wakeup
    Queue::assertPushed(ScanApplicationDocument::class, 1);
    expect(Storage::disk('application_documents')->exists($document->path))->toBeTrue();
});

it('resets an exhausted phase only for the named, unleased document', function () {
    Queue::fake();
    $work = app(ApplicationDocumentWork::class);
    $exhausted = workDocument(['work_attempts' => 3, 'work_dispatched_at' => now()->subMinute()]);
    $fresh = workDocument(['work_attempts' => 1]);
    $leased = workDocument(['work_attempts' => 3, 'work_lease_until' => now()->addSeconds(30)]);

    expect($work->resetExhausted($exhausted->id))->toBeNull();
    expect($work->resetExhausted($fresh->id))->not->toBeNull();
    expect($work->resetExhausted($leased->id))->not->toBeNull();
    expect($work->resetExhausted(777777))->not->toBeNull();

    $row = $exhausted->fresh();
    expect($row->work_attempts)->toBe(0)->and($row->work_dispatched_at)->toBeNull()->and($row->status)->toBe('pending_scan')->and($row->path)->toBe($exhausted->path);
    expect($fresh->fresh()->work_attempts)->toBe(1)->and($leased->fresh()->work_attempts)->toBe(3);
});
