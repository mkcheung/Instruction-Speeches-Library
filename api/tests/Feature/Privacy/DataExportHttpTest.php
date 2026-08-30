<?php

use App\Models\Annotation;
use App\Models\AuditLog;
use App\Models\DataExport;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-11-FROZEN-CONTRACT.md §7. Queue is `sync` in testing
 * (phpunit.xml), so `GenerateDataExport` runs inline within the request —
 * no manual queue draining needed.
 */
it('generates an account export containing owned speeches, reviewer identity, and the video duration read from speech_assets', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewer = User::factory()->create();
    $reviewer->assignRole('coach');

    $speech = Speech::factory()->for($speaker)->create(['title' => 'My Best Speech']);
    // `speeches.duration_seconds` has no writer anywhere and is always
    // null — the export must read duration off the primary video asset.
    SpeechAsset::factory()->for($speech)->video()->ready()->create(['duration_seconds' => 245.5]);

    $review = Review::factory()->published()->create([
        'speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $speaker->id, 'status' => 'published',
    ]);
    Annotation::factory()->for($review)->create(['body' => 'Published commentary.', 'published_at' => now()]);
    Annotation::factory()->for($review)->draft()->create(['body' => 'Secret draft commentary.']);

    $requested = $this->actingAs($speaker)->postJson('/api/privacy/exports', ['kind' => 'account']);
    $requested->assertCreated();
    $exportId = $requested->json('export.id');

    $export = DataExport::find($exportId);
    expect($export->status)->toBe('ready')
        ->and($export->path)->not->toBeNull();

    $list = $this->actingAs($speaker)->getJson('/api/privacy/exports');
    $list->assertOk()->assertJsonPath('exports.0.status', 'ready');

    $download = $this->actingAs($speaker)->getJson("/api/privacy/exports/{$exportId}/download");
    $download->assertOk()->assertJsonStructure(['url']);

    $payload = json_decode(Storage::disk('media')->get($export->path), true);
    expect($payload['speeches'][0]['title'])->toBe('My Best Speech')
        ->and($payload['speeches'][0]['duration_seconds'])->toBe(245.5)
        ->and($payload['speeches'][0]['reviews'][0]['reviewer']['id'])->toBe($reviewer->id);

    $bodies = collect($payload['speeches'][0]['reviews'][0]['annotations'])->pluck('body')->all();
    expect($bodies)->toBe(['Published commentary.'])
        ->and($bodies)->not->toContain('Secret draft commentary.');

    expect(AuditLog::where('action', 'account.export.requested')->count())->toBe(1);
    expect(AuditLog::where('action', 'account.export.downloaded')->count())->toBe(1);
});

it('generates a reviewer_annotations export scoped to speeches the reviewer does not own, including drafts', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewer = User::factory()->create();
    $reviewer->assignRole('coach');
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $speaker->id, 'status' => 'in_progress',
    ]);
    Annotation::factory()->for($review)->draft()->create(['body' => 'My in-progress note.']);

    $requested = $this->actingAs($reviewer)->postJson('/api/privacy/exports', ['kind' => 'reviewer_annotations']);
    $requested->assertCreated();
    $export = DataExport::find($requested->json('export.id'));

    $payload = json_decode(Storage::disk('media')->get($export->path), true);
    expect($payload['reviews'])->toHaveCount(1)
        ->and($payload['reviews'][0]['annotations'][0]['body'])->toBe('My in-progress note.');
});

it('forbids downloading someone else\'s export', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    $owner = User::factory()->create();
    $owner->assignRole('member');
    $stranger = User::factory()->create();
    $stranger->assignRole('member');

    $requested = $this->actingAs($owner)->postJson('/api/privacy/exports', ['kind' => 'account']);
    $exportId = $requested->json('export.id');

    $this->actingAs($stranger)->getJson("/api/privacy/exports/{$exportId}/download")->assertForbidden();
});

it('refuses to download a ready export past its expires_at', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    $owner = User::factory()->create();
    $owner->assignRole('member');
    $export = DataExport::factory()->ready()->for($owner)->create(['expires_at' => now()->subDay()]);
    Storage::disk('media')->put($export->path, '{}');

    $this->actingAs($owner)->getJson("/api/privacy/exports/{$export->id}/download")
        ->assertStatus(410);
});
