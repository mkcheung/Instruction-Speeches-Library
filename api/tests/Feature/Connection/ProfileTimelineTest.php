<?php

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * MODERNIZATION_PLAN §6.7.3 / STEP-13-FROZEN-CONTRACT.md §4/§9/§10. The
 * profile timeline: reviews-driven, connection-blind. See
 * ProfileTimelineController's own docblock and
 * tests/Feature/Speech/VisibleToSnapshotTest.php for the invariant this
 * protects.
 */
it('shows only speeches the viewer personally reviewed, with only their own commentary', function () {
    $viewer = User::factory()->create(['username' => 'viewer1']);
    $profileUser = User::factory()->create(['username' => 'jordan']);
    $otherReviewer = User::factory()->create();

    $reviewed = Speech::factory()->for($profileUser)->create(['title' => 'Reviewed by viewer']);
    Review::factory()->for($reviewed)->create([
        'reviewer_id' => $viewer->id,
        'speech_owner_id' => $profileUser->id,
        'status' => 'published',
        'annotations_count' => 12,
        'published_annotations_count' => 12,
    ]);

    $notReviewedByViewer = Speech::factory()->for($profileUser)->create(['title' => 'Reviewed by someone else']);
    Review::factory()->for($notReviewedByViewer)->create([
        'reviewer_id' => $otherReviewer->id,
        'speech_owner_id' => $profileUser->id,
        'status' => 'published',
    ]);

    $response = $this->actingAs($viewer)->getJson('/api/u/jordan/timeline');
    $response->assertOk();

    $titles = collect($response->json('timeline'))->pluck('speech.title');
    expect($titles)->toContain('Reviewed by viewer');
    expect($titles)->not->toContain('Reviewed by someone else');
    expect($response->json('timeline.0.commentary.notes_count'))->toBe(12);
});

it('renders an empty timeline for a profile never reviewed, by design', function () {
    $viewer = User::factory()->create();
    $profileUser = User::factory()->create(['username' => 'nobodyreviewed']);
    Speech::factory()->for($profileUser)->create();

    $response = $this->actingAs($viewer)->getJson('/api/u/nobodyreviewed/timeline');

    $response->assertOk();
    expect($response->json('timeline'))->toBe([]);
});

it('the reviews-they-left-you tab is the mirror query', function () {
    $viewer = User::factory()->create();
    $profileUser = User::factory()->create(['username' => 'coach1']);

    $mySpeech = Speech::factory()->for($viewer)->create(['title' => 'My speech, their review']);
    Review::factory()->for($mySpeech)->create([
        'reviewer_id' => $profileUser->id,
        'speech_owner_id' => $viewer->id,
        'status' => 'published',
    ]);

    $response = $this->actingAs($viewer)->getJson('/api/u/coach1/timeline?tab=received');
    $response->assertOk();

    expect(collect($response->json('timeline'))->pluck('speech.title'))->toContain('My speech, their review');
});

it('never issues a query against connections while building the timeline', function () {
    $viewer = User::factory()->create();
    $profileUser = User::factory()->create(['username' => 'noconn']);
    $speech = Speech::factory()->for($profileUser)->create();
    Review::factory()->for($speech)->create(['reviewer_id' => $viewer->id, 'speech_owner_id' => $profileUser->id, 'status' => 'published']);

    DB::enableQueryLog();
    $this->actingAs($viewer)->getJson('/api/u/noconn/timeline')->assertOk();
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    $touchesConnections = collect($log)->contains(fn ($entry) => str_contains($entry['query'], 'connections'));
    expect($touchesConnections)->toBeFalse();
});

it('embeds the arc chain per timeline item and redacts non-visible ancestors', function () {
    $viewer = User::factory()->create();
    $profileUser = User::factory()->create(['username' => 'arcuser']);

    $v1 = Speech::factory()->for($profileUser)->create(['title' => 'Attempt 1']);
    $v2 = Speech::factory()->for($profileUser)->create(['title' => 'Attempt 2', 'supersedes_id' => $v1->id, 'change_note' => 'Fixed filler words']);

    // Viewer only holds a review (grant) on v2, not v1.
    Review::factory()->for($v2)->create(['reviewer_id' => $viewer->id, 'speech_owner_id' => $profileUser->id, 'status' => 'published']);

    $response = $this->actingAs($viewer)->getJson('/api/u/arcuser/timeline');
    $response->assertOk();

    $arc = $response->json('timeline.0.arc');
    expect($arc)->not->toBeNull();
    expect(collect($arc)->pluck('id'))->toContain($v1->id, $v2->id);

    $v1Entry = collect($arc)->firstWhere('id', $v1->id);
    // v1 exists in the chain (the arc strip shows it happened) but its
    // title/date/change_note must NOT leak — the viewer holds no grant on
    // it. "Being shown v2 exists never makes v2 playable" applies
    // symmetrically to v1 here.
    expect($v1Entry['visible'])->toBeFalse();
    expect($v1Entry['title'])->toBeNull();

    $v2Entry = collect($arc)->firstWhere('id', $v2->id);
    expect($v2Entry['visible'])->toBeTrue();
    expect($v2Entry['title'])->toBe('Attempt 2');
});
