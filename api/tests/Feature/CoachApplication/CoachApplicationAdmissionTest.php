<?php

use App\Models\ApplicationDocument;
use App\Models\CoachApplication;
use App\Models\User;
use App\Services\ApplicationDocumentWork;
use App\Services\CoachApplicationSubmissionService;
use App\Services\StorageObjectRemover;
use Database\Seeders\RoleSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

function admissionApplicant(string $status = 'draft'): array
{
    test()->seed(RoleSeeder::class);
    $user = User::factory()->create();
    $user->assignRole('member');
    $application = CoachApplication::query()->create(['user_id' => $user->id, 'status' => $status, 'statement' => 's']);

    return [$user, $application];
}

function admissionPdf(string $name = 'a.pdf', ?string $bytes = null): UploadedFile
{
    return UploadedFile::fake()->createWithContent($name, $bytes ?? "%PDF-1.4\n1 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");
}

/** @param Closure(string, mixed): (bool|string) $put */
function admissionDisk(Closure $put): void
{
    $disk = Storage::fake('application_documents');
    $mock = Mockery::mock($disk)->makePartial();
    $mock->shouldReceive('put')->andReturnUsing($put);
    Storage::set('application_documents', $mock);
}

function admissionFiles(): array
{
    return Storage::disk('application_documents')->allFiles();
}

it('admits both documents in one request and wakes each through the work protocol after commit', function () {
    Bus::fake();
    Storage::fake('application_documents');
    [$user, $application] = admissionApplicant();

    $this->actingAs($user)->postJson("/api/coach-applications/{$application->id}/documents", [
        'documents' => [admissionPdf('a.pdf'), admissionPdf('b.pdf')],
    ])->assertCreated()->assertJsonCount(2, 'coachApplication.documents');

    expect(ApplicationDocument::query()->where('status', 'pending_scan')->count())->toBe(2)
        ->and(ApplicationDocument::query()->whereNotNull('work_dispatched_at')->count())->toBe(2)
        ->and(admissionFiles())->toHaveCount(2);
});

it('a second invalid file fails the whole batch before any write', function () {
    Storage::fake('application_documents');
    [$user, $application] = admissionApplicant();

    $this->actingAs($user)->postJson("/api/coach-applications/{$application->id}/documents", [
        'documents' => [admissionPdf('a.pdf'), admissionPdf('b.pdf', 'not a pdf')],
    ])->assertStatus(422);

    expect(ApplicationDocument::query()->count())->toBe(0)->and(admissionFiles())->toBe([]);
});

it('enforces the two-document cap against the fresh count', function () {
    Storage::fake('application_documents');
    [$user, $application] = admissionApplicant();
    $this->actingAs($user)->postJson("/api/coach-applications/{$application->id}/documents", ['documents' => [admissionPdf()]])->assertCreated();

    $this->actingAs($user)->postJson("/api/coach-applications/{$application->id}/documents", [
        'documents' => [admissionPdf('b.pdf'), admissionPdf('c.pdf')],
    ])->assertStatus(422);

    expect(ApplicationDocument::query()->count())->toBe(1)->and(admissionFiles())->toHaveCount(1);
});

it('rejects uploads once the application is decided, and for non-owners', function () {
    Storage::fake('application_documents');
    [$user, $application] = admissionApplicant('approved');
    $this->actingAs($user)->postJson("/api/coach-applications/{$application->id}/documents", ['documents' => [admissionPdf()]])->assertStatus(409);
    $other = User::factory()->create();
    $this->actingAs($other)->postJson("/api/coach-applications/{$application->id}/documents", ['documents' => [admissionPdf()]])->assertNotFound();
    expect(ApplicationDocument::query()->count())->toBe(0)->and(admissionFiles())->toBe([]);
});

it('a storage write returning false gives a controlled 503 with no rows, jobs or files', function () {
    Bus::fake();
    [$user, $application] = admissionApplicant();
    admissionDisk(fn () => false);

    $this->actingAs($user)->postJson("/api/coach-applications/{$application->id}/documents", ['documents' => [admissionPdf()]])
        ->assertStatus(503);

    expect(ApplicationDocument::query()->count())->toBe(0)->and(admissionFiles())->toBe([]);
    Bus::assertNothingDispatched();
});

it('a false write on the second file compensates the first staged object', function () {
    [$user, $application] = admissionApplicant();
    $n = 0;
    admissionDisk(function ($path, $contents) use (&$n) {
        return ++$n === 2 ? false : Storage::disk('application_documents')->getDriver()->write($path, $contents) ?? true;
    });

    $this->actingAs($user)->postJson("/api/coach-applications/{$application->id}/documents", [
        'documents' => [admissionPdf('a.pdf'), admissionPdf('b.pdf')],
    ])->assertStatus(503);

    expect(ApplicationDocument::query()->count())->toBe(0)->and(admissionFiles())->toBe([]);
});

it('a storage throw compensates staged objects and propagates', function () {
    [$user, $application] = admissionApplicant();
    $n = 0;
    admissionDisk(function ($path, $contents) use (&$n) {
        if (++$n === 2) {
            throw new RuntimeException('disk exploded');
        }
        Storage::disk('application_documents')->getDriver()->write($path, $contents);

        return true;
    });

    $this->withoutExceptionHandling();
    expect(fn () => $this->actingAs($user)->postJson("/api/coach-applications/{$application->id}/documents", [
        'documents' => [admissionPdf('a.pdf'), admissionPdf('b.pdf')],
    ]))->toThrow(RuntimeException::class, 'disk exploded');

    expect(ApplicationDocument::query()->count())->toBe(0)->and(admissionFiles())->toBe([]);
});

it('a database failure during admission rolls back every row and removes only this attempts files', function () {
    Storage::fake('application_documents');
    [$user, $application] = admissionApplicant();
    Storage::disk('application_documents')->put('applications/keep/other.pdf', 'x');
    $created = 0;
    ApplicationDocument::creating(function () use (&$created) {
        if (++$created === 2) {
            throw new RuntimeException('insert failed');
        }
    });

    $this->withoutExceptionHandling();
    expect(fn () => $this->actingAs($user)->postJson("/api/coach-applications/{$application->id}/documents", [
        'documents' => [admissionPdf('a.pdf'), admissionPdf('b.pdf')],
    ]))->toThrow(RuntimeException::class, 'insert failed');
    ApplicationDocument::flushEventListeners();

    expect(ApplicationDocument::query()->count())->toBe(0)
        ->and(admissionFiles())->toBe(['applications/keep/other.pdf']);
});

it('logs the exact target when compensation itself fails', function () {
    Log::spy();
    [$user, $application] = admissionApplicant();
    $disk = Storage::fake('application_documents');
    $mock = Mockery::mock($disk)->makePartial();
    $mock->shouldReceive('delete')->andReturn(false);
    Storage::set('application_documents', $mock);
    ApplicationDocument::creating(fn () => throw new RuntimeException('insert failed'));

    $this->withoutExceptionHandling();
    expect(fn () => $this->actingAs($user)->postJson("/api/coach-applications/{$application->id}/documents", ['documents' => [admissionPdf()]]))
        ->toThrow(RuntimeException::class);
    ApplicationDocument::flushEventListeners();

    Log::shouldHaveReceived('error')->withArgs(fn ($m, $c = []) => isset($c['path']) && str_starts_with($c['path'], "applications/{$application->id}/"));
});

it('an enqueue failure after commit still returns 201 with the committed pending snapshot', function () {
    Storage::fake('application_documents');
    [$user, $application] = admissionApplicant();
    $this->app->instance(ApplicationDocumentWork::class, new class(app(StorageObjectRemover::class)) extends ApplicationDocumentWork
    {
        public function ensureQueued(int $documentId): bool
        {
            throw new RuntimeException('broker down');
        }
    });

    $this->actingAs($user)->postJson("/api/coach-applications/{$application->id}/documents", [
        'documents' => [admissionPdf('a.pdf'), admissionPdf('b.pdf')],
    ])->assertCreated()->assertJsonCount(2, 'coachApplication.documents');

    expect(ApplicationDocument::query()->where('status', 'pending_scan')->count())->toBe(2)
        ->and(admissionFiles())->toHaveCount(2);
});

it('inside an outer transaction that rolls back, no rows remain and no scan work is woken', function () {
    Bus::fake();
    Storage::fake('application_documents');
    [$user, $application] = admissionApplicant();
    $service = app(CoachApplicationSubmissionService::class);

    try {
        DB::transaction(function () use ($service, $user, $application) {
            $service->addDocuments($user, $application, [admissionPdf()]);
            throw new RuntimeException('outer');
        });
    } catch (RuntimeException) {
    }

    expect(ApplicationDocument::query()->count())->toBe(0);
    Bus::assertNothingDispatched();
});

it('creation locks the applicant first; first POST creates draft, second submits the same row', function () {
    [$user] = admissionApplicant();
    CoachApplication::query()->delete();
    $a = $this->actingAs($user)->postJson('/api/coach-applications', ['statement' => 's'])->assertCreated();
    $b = $this->actingAs($user)->postJson('/api/coach-applications', ['statement' => 's'])->assertCreated();
    expect($a->json('coachApplication.id'))->toBe($b->json('coachApplication.id'))
        ->and($b->json('coachApplication.status'))->toBe('submitted');
    $this->actingAs($user)->postJson('/api/coach-applications', ['statement' => 'changed'])->assertCreated()
        ->assertJsonPath('coachApplication.statement', 'changed');
    CoachApplication::query()->update(['status' => 'withdrawn']);
    $this->actingAs($user)->postJson('/api/coach-applications', ['statement' => 's'])->assertStatus(409);
});
