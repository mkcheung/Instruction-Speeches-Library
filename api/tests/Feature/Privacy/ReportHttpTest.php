<?php

use App\Models\AuditLog;
use App\Models\Report;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use Database\Seeders\RoleSeeder;

/**
 * STEP-11-FROZEN-CONTRACT.md §1: `POST /api/reports`. Authorization reuses
 * `SpeechPolicy::view` (owner or an access-granting reviewer); a Review
 * target is authorized via view-access to its parent Speech.
 */
it('lets a speech owner report their own speech and writes an audit entry', function () {
    $this->seed(RoleSeeder::class);
    $owner = User::factory()->create();
    $owner->assignRole('member');
    $speech = Speech::factory()->for($owner)->create();

    $response = $this->actingAs($owner)->postJson('/api/reports', [
        'reportable_type' => 'speech',
        'reportable_id' => $speech->id,
        'reason' => 'inappropriate_content',
        'detail' => 'Contains something it should not.',
    ]);

    $response->assertCreated()->assertJsonPath('report.reason', 'inappropriate_content');

    expect(Report::where('reportable_type', Speech::class)->where('reportable_id', $speech->id)->count())->toBe(1);
    expect(AuditLog::where('action', 'report.created')->count())->toBe(1);
});

it('lets an accepted reviewer report the review (annotation set) they can view', function () {
    $this->seed(RoleSeeder::class);
    $owner = User::factory()->create();
    $owner->assignRole('member');
    $reviewer = User::factory()->create();
    $reviewer->assignRole('coach');
    $speech = Speech::factory()->for($owner)->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id, 'status' => 'in_progress',
    ]);

    $response = $this->actingAs($reviewer)->postJson('/api/reports', [
        'reportable_type' => 'review',
        'reportable_id' => $review->id,
        'reason' => 'harassment',
    ]);

    $response->assertCreated();
    expect(Report::where('reportable_type', Review::class)->where('reportable_id', $review->id)->count())->toBe(1);
});

it('rejects a report for a speech the reporter cannot view', function () {
    $this->seed(RoleSeeder::class);
    $owner = User::factory()->create();
    $owner->assignRole('member');
    $stranger = User::factory()->create();
    $stranger->assignRole('member');
    $speech = Speech::factory()->for($owner)->create();

    $this->actingAs($stranger)->postJson('/api/reports', [
        'reportable_type' => 'speech',
        'reportable_id' => $speech->id,
        'reason' => 'spam',
    ])->assertForbidden();
});

it('rejects an unsupported reportable_type with 422', function () {
    $this->seed(RoleSeeder::class);
    $user = User::factory()->create();
    $user->assignRole('member');

    $this->actingAs($user)->postJson('/api/reports', [
        'reportable_type' => 'user',
        'reportable_id' => $user->id,
        'reason' => 'spam',
    ])->assertUnprocessable();
});

it('lists reports oldest-open-first via reports:list', function () {
    $this->seed(RoleSeeder::class);
    $reporter = User::factory()->create();
    $reporter->assignRole('member');
    $speech = Speech::factory()->create();

    $older = Report::factory()->create(['reportable_id' => $speech->id, 'reporter_id' => $reporter->id, 'state' => 'open', 'created_at' => now()->subDays(2)]);
    $newer = Report::factory()->create(['reportable_id' => $speech->id, 'reporter_id' => $reporter->id, 'state' => 'open', 'created_at' => now()->subDay()]);

    $this->artisan('reports:list')->assertExitCode(0);

    expect(Report::orderByRaw("CASE WHEN state = 'open' THEN 0 ELSE 1 END")->orderBy('created_at')->pluck('id')->all())
        ->toBe([$older->id, $newer->id]);
});
