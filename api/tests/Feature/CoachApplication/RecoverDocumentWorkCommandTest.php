<?php

use App\Jobs\ScanApplicationDocument;
use App\Models\ApplicationDocument;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Queue;

require_once __DIR__.'/DocumentWorkHelpers.php';

it('is scheduled every five minutes', function () {
    $event = collect(app(Schedule::class)->events())
        ->first(fn ($e) => str_contains($e->command, 'coach:recover-document-work'));

    expect($event)->not->toBeNull()->and($event->expression)->toBe('*/5 * * * *');
});

it('queues eligible work, skipping ineligible rows', function () {
    Queue::fake();
    $pending = workDocument();
    $infected = workDocument(['status' => 'infected']);
    workDocument(['status' => 'clean']);
    workDocument(['status' => 'infected', 'path' => ''], false);
    workDocument(['work_attempts' => 3]);
    workDocument(['work_lease_until' => now()->addSeconds(30)]);

    $this->artisan('coach:recover-document-work')->assertSuccessful();

    Queue::assertPushed(ScanApplicationDocument::class, 2);
    Queue::assertPushed(ScanApplicationDocument::class, fn ($j) => $j->documentId === $pending->id);
    Queue::assertPushed(ScanApplicationDocument::class, fn ($j) => $j->documentId === $infected->id);
});

it('caps a run at 100 and prefers never-dispatched then oldest-dispatched', function () {
    Queue::fake();
    $application = workDocument()->application_id;
    $stale = [];
    for ($i = 0; $i < 102; $i++) {
        $d = new ApplicationDocument;
        $d->forceFill([
            'application_id' => $application, 'disk' => 'application_documents', 'path' => "applications/{$application}/f{$i}.pdf",
            'original_filename' => 'f', 'byte_size' => 1, 'status' => 'pending_scan',
            // Ids 2..101 dispatched an hour ago (oldest first by id), last two never dispatched.
            'work_dispatched_at' => $i < 100 ? now()->subHour()->subSeconds(1000 - $i) : null,
        ])->save();
        $stale[] = $d->id;
    }
    $first = ApplicationDocument::query()->orderBy('id')->first();
    $first->forceFill(['work_dispatched_at' => now()->subMinute()])->save(); // within throttle -> not eligible

    $this->artisan('coach:recover-document-work')->assertSuccessful();

    $ids = Queue::pushed(ScanApplicationDocument::class)->map(fn ($j) => $j->documentId)->all();
    expect($ids)->toHaveCount(100)
        ->and($ids)->toContain($stale[100], $stale[101]) // never dispatched go first
        ->and($ids)->toContain($stale[0])                // oldest dispatched
        ->and($ids)->not->toContain($stale[99])          // newest dispatched dropped by the cap
        ->and($ids)->not->toContain($first->id);
});

it('does not double-queue across back to back runs', function () {
    Queue::fake();
    workDocument();

    $this->artisan('coach:recover-document-work')->assertSuccessful();
    $this->artisan('coach:recover-document-work')->assertSuccessful();

    Queue::assertPushed(ScanApplicationDocument::class, 1);
});

it('refuses a bulk exhausted reset', function () {
    Queue::fake();
    $document = workDocument(['work_attempts' => 3]);

    $this->artisan('coach:recover-document-work --retry-exhausted')->assertFailed();

    expect($document->fresh()->work_attempts)->toBe(3);
    Queue::assertNothingPushed();
});

it('resets and queues one named exhausted document', function () {
    Queue::fake();
    $document = workDocument(['work_attempts' => 3]);
    $other = workDocument(['work_attempts' => 3]);

    $this->artisan("coach:recover-document-work --document-id={$document->id} --retry-exhausted")->assertSuccessful();

    expect($document->fresh()->work_attempts)->toBe(0)->and($other->fresh()->work_attempts)->toBe(3);
    Queue::assertPushed(ScanApplicationDocument::class, 1);
});

it('refuses a targeted reset of a leased or non-exhausted document', function () {
    Queue::fake();
    $leased = workDocument(['work_attempts' => 3, 'work_lease_until' => now()->addSeconds(30)]);
    $fresh = workDocument(['work_attempts' => 1]);

    $this->artisan("coach:recover-document-work --document-id={$leased->id} --retry-exhausted")->assertFailed();
    $this->artisan("coach:recover-document-work --document-id={$fresh->id} --retry-exhausted")->assertFailed();

    Queue::assertNothingPushed();
});

it('queues just the named document without the reset flag', function () {
    Queue::fake();
    $a = workDocument();
    workDocument();

    $this->artisan("coach:recover-document-work --document-id={$a->id}")->assertSuccessful();

    Queue::assertPushed(ScanApplicationDocument::class, 1);
});
