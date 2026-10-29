<?php

use App\Jobs\ScanApplicationDocument;
use App\Models\ApplicationDocument;
use App\Models\CoachApplication;
use App\Models\User;
use App\Notifications\CoachApplicationApproved;
use App\Services\CoachApplicationDecisionService;
use Database\Seeders\RoleSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;

function minimalPdfBytes(): string
{
    return "%PDF-1.4\n1 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";
}

it('saves a draft on the first call, then submits on the second, matching the two-step applicant flow', function () {
    $this->seed(RoleSeeder::class);
    $member = User::factory()->create();
    $member->assignRole('member');

    $draft = $this->actingAs($member)->postJson('/api/coach-applications', [
        'statement' => 'I have ten years of coaching experience.',
    ])->assertCreated();
    $draft->assertJsonPath('coachApplication.status', 'draft');

    $submitted = $this->actingAs($member)->postJson('/api/coach-applications', [
        'statement' => 'I have ten years of coaching experience.',
    ])->assertCreated();
    $submitted->assertJsonPath('coachApplication.status', 'submitted');

    $this->actingAs($member)->getJson('/api/coach-applications/me')
        ->assertOk()
        ->assertJsonPath('coachApplication.status', 'submitted');

    // A third call (reload, double-click) must not crash — same row, no-op.
    $this->actingAs($member)->postJson('/api/coach-applications', [
        'statement' => 'I have ten years of coaching experience.',
    ])->assertCreated()->assertJsonPath('coachApplication.status', 'submitted');

    expect(CoachApplication::query()->where('user_id', $member->id)->count())->toBe(1);
});

it('uploads up to two PDF documents and queues a scan job for each', function () {
    Bus::fake();
    Storage::fake('application_documents');
    $this->seed(RoleSeeder::class);
    $member = User::factory()->create();
    $member->assignRole('member');

    $this->actingAs($member)->postJson('/api/coach-applications', ['statement' => 'Statement.'])->assertCreated();
    $application = CoachApplication::query()->where('user_id', $member->id)->firstOrFail();

    $pdf1 = UploadedFile::fake()->createWithContent('cert1.pdf', minimalPdfBytes());
    $pdf2 = UploadedFile::fake()->createWithContent('cert2.pdf', minimalPdfBytes());

    $this->actingAs($member)->postJson("/api/coach-applications/{$application->id}/documents", [
        'documents' => [$pdf1, $pdf2],
    ])->assertCreated();

    expect(ApplicationDocument::query()->where('application_id', $application->id)->count())->toBe(2);
    Bus::assertDispatched(ScanApplicationDocument::class, 2);
});

it('rejects a non-PDF upload by magic bytes even with a .pdf extension and correct mime', function () {
    Storage::fake('application_documents');
    $this->seed(RoleSeeder::class);
    $member = User::factory()->create();
    $member->assignRole('member');
    $this->actingAs($member)->postJson('/api/coach-applications', ['statement' => 'Statement.'])->assertCreated();
    $application = CoachApplication::query()->where('user_id', $member->id)->firstOrFail();

    $fake = UploadedFile::fake()->createWithContent('cert.pdf', 'not really a pdf');

    $this->actingAs($member)->postJson("/api/coach-applications/{$application->id}/documents", [
        'documents' => [$fake],
    ])->assertStatus(422);
});

it('rejects a third document on an application that already has two', function () {
    Storage::fake('application_documents');
    $this->seed(RoleSeeder::class);
    $member = User::factory()->create();
    $member->assignRole('member');
    $this->actingAs($member)->postJson('/api/coach-applications', ['statement' => 'Statement.'])->assertCreated();
    $application = CoachApplication::query()->where('user_id', $member->id)->firstOrFail();

    $this->actingAs($member)->postJson("/api/coach-applications/{$application->id}/documents", [
        'documents' => [
            UploadedFile::fake()->createWithContent('a.pdf', minimalPdfBytes()),
            UploadedFile::fake()->createWithContent('b.pdf', minimalPdfBytes()),
        ],
    ])->assertCreated();

    $this->actingAs($member)->postJson("/api/coach-applications/{$application->id}/documents", [
        'documents' => [UploadedFile::fake()->createWithContent('c.pdf', minimalPdfBytes())],
    ])->assertStatus(422);
});

it('a coach approval routes through RoleAssignmentService and reaches the reviewer directory immediately', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    // Onboarded (has a username) — `scopeReviewerCandidates()` now
    // requires `whereNotNull('username')` (User.php) so a directory row
    // always has a resolvable `/u/{username}` profile; this test is about
    // coach approval reaching the directory, not about the onboarding
    // gate, so give the member the username that gate expects.
    $member = User::factory()->create(['username' => 'reviewercandidate']);
    $member->assignRole('member');

    $this->actingAs($member)->postJson('/api/coach-applications', ['statement' => 'Statement.'])->assertCreated();
    $this->actingAs($member)->postJson('/api/coach-applications', ['statement' => 'Statement.'])->assertCreated();
    $application = CoachApplication::query()->where('user_id', $member->id)->firstOrFail();
    expect($application->status)->toBe('submitted');
    // Approval needs a clean document (PLAN-COACH-APPLICATION-REVIEW-PAGE.md §7).
    ApplicationDocument::query()->create([
        'application_id' => $application->id,
        'disk' => 'application_documents',
        'path' => 'applications/'.$application->id.'/clean.pdf',
        'original_filename' => 'cert.pdf',
        'byte_size' => 100,
        'sha256' => str_repeat('a', 64),
        'status' => 'clean',
    ]);

    app(CoachApplicationDecisionService::class)->approve($admin, $application, 'Looks great.');

    expect($member->fresh()->hasRole('coach'))->toBeTrue();
    expect(User::query()->reviewerCandidates(null, 'coach')->whereKey($member->id)->exists())->toBeTrue();
    Notification::assertSentTo($member, CoachApplicationApproved::class);
});

it('an admin cannot submit, withdraw, or upload documents to someone else\'s application', function () {
    $this->seed(RoleSeeder::class);
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $member = User::factory()->create();
    $member->assignRole('member');

    $this->actingAs($member)->postJson('/api/coach-applications', ['statement' => 'Statement.'])->assertCreated();
    $application = CoachApplication::query()->where('user_id', $member->id)->firstOrFail();

    Storage::fake('application_documents');
    $this->actingAs($admin)->postJson("/api/coach-applications/{$application->id}/documents", [
        'documents' => [UploadedFile::fake()->createWithContent('a.pdf', minimalPdfBytes())],
    ])->assertNotFound();
});

it('reapplying after rejection creates a new draft row; the decided row keeps its decision and documents', function () {
    Bus::fake();
    Storage::fake('application_documents');
    $this->seed(RoleSeeder::class);
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $member = User::factory()->create();
    $member->assignRole('member');

    $this->actingAs($member)->postJson('/api/coach-applications', ['statement' => 'First attempt.'])->assertCreated();
    $old = CoachApplication::query()->where('user_id', $member->id)->firstOrFail();
    $this->actingAs($member)->postJson("/api/coach-applications/{$old->id}/documents", [
        'documents' => [
            UploadedFile::fake()->createWithContent('a.pdf', minimalPdfBytes()),
            UploadedFile::fake()->createWithContent('b.pdf', minimalPdfBytes()),
        ],
    ])->assertCreated();
    $this->actingAs($member)->postJson('/api/coach-applications', ['statement' => 'First attempt.'])->assertCreated();

    app(CoachApplicationDecisionService::class)->reject($admin, $old, 'Not enough evidence.');
    $decided = $old->fresh();
    expect($decided->status)->toBe('rejected');

    // PLAN-COACH-APPLICATION-REVIEW-PAGE.md §8: a reapplication is a new row.
    $reapplied = $this->actingAs($member)->postJson('/api/coach-applications', [
        'statement' => 'Second attempt, with more detail.',
    ])->assertCreated();
    $reapplied->assertJsonPath('coachApplication.status', 'draft')
        ->assertJsonPath('coachApplication.statement', 'Second attempt, with more detail.');
    $newId = $reapplied->json('coachApplication.id');
    expect($newId)->not->toBe($old->id);
    $new = CoachApplication::query()->findOrFail($newId);
    expect($new->documents()->count())->toBe(0);

    // The decided row is untouched: decision, reason, retention clock, documents.
    $after = $old->fresh();
    expect($after->status)->toBe('rejected')
        ->and($after->decided_at)->toBe($decided->decided_at)
        ->and($after->decision_reason)->toBe('Not enough evidence.')
        ->and($after->documents_purge_after)->not->toBeNull()
        ->and($after->documents_purge_after)->toBe($decided->documents_purge_after)
        ->and($after->documents()->count())->toBe(2);

    $this->actingAs($member)->getJson('/api/coach-applications/me')
        ->assertOk()
        ->assertJsonPath('coachApplication.id', $newId)
        ->assertJsonPath('coachApplication.status', 'draft');

    // The two-document cap is per attempt: the old row's two do not count.
    $this->actingAs($member)->postJson("/api/coach-applications/{$newId}/documents", [
        'documents' => [
            UploadedFile::fake()->createWithContent('c.pdf', minimalPdfBytes()),
            UploadedFile::fake()->createWithContent('d.pdf', minimalPdfBytes()),
        ],
    ])->assertCreated();
    expect($new->documents()->count())->toBe(2);

    $this->actingAs($member)->postJson('/api/coach-applications', [
        'statement' => 'Second attempt, with more detail.',
    ])->assertCreated()
        ->assertJsonPath('coachApplication.id', $newId)
        ->assertJsonPath('coachApplication.status', 'submitted');
    expect(CoachApplication::query()->where('user_id', $member->id)->count())->toBe(2);
});

it('refuses coach-application writes once account erasure has started, leaving no staged object', function () {
    Bus::fake();
    Storage::fake('application_documents');
    $this->seed(RoleSeeder::class);
    $member = User::factory()->create();
    $member->assignRole('member');

    $this->actingAs($member)->postJson('/api/coach-applications', ['statement' => 'Statement.'])->assertCreated();
    $application = CoachApplication::query()->where('user_id', $member->id)->firstOrFail();

    // PLAN-COACH-APPLICATION-REVIEW-PAGE.md §9: the gate AccountErasureService
    // (and `DELETE /api/me`) stamp before step 1.
    $member->forceFill(['erasure_started_at' => now()])->save();

    $this->actingAs($member)->postJson('/api/coach-applications', ['statement' => 'Statement.'])
        ->assertStatus(409);
    expect($application->fresh()->status)->toBe('draft');

    $this->actingAs($member)->postJson("/api/coach-applications/{$application->id}/documents", [
        'documents' => [UploadedFile::fake()->createWithContent('a.pdf', minimalPdfBytes())],
    ])->assertStatus(409);

    expect(ApplicationDocument::query()->count())->toBe(0)
        ->and(Storage::disk('application_documents')->allFiles())->toBe([]);
    Bus::assertNothingDispatched();
});
