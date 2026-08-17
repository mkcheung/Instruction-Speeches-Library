<?php

use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Policies\AnnotationPolicy;
use Database\Seeders\RoleSeeder;

/**
 * STEP-08-essay.md / the frozen STEP-08 backend contract: HTTP-level
 * coverage of the essay surface. Self-contained helper functions
 * (deliberately not shared with AnnotationWriteHttpTest — see that file's
 * own docblock for why a same-named global function declared in a
 * different test file breaks isolated runs).
 */
function essayAcceptedInProgressReview(User $speaker, User $reviewer, ?Speech $speech = null): Review
{
    $speech ??= Speech::factory()->for($speaker)->create();

    return Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'status' => 'in_progress',
    ]);
}

function essaySpeakerAndCoach(): array
{
    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewer = User::factory()->create();
    $reviewer->assignRole('coach');

    return [$speaker, $reviewer];
}

// 1. Reviewer writes essay, drafts persist across requests.
it('lets a reviewer write an essay draft that persists across requests', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = essaySpeakerAndCoach();
    $review = essayAcceptedInProgressReview($speaker, $reviewer);

    $first = $this->actingAs($reviewer)->putJson("/api/speeches/{$review->speech_id}/essay", [
        'html' => '<p>My first draft paragraph.</p>',
        'lock_version' => 0,
    ]);

    $first->assertOk();
    $first->assertJsonPath('essay.essay_lock_version', 1);
    $first->assertJsonPath('essay.essay_text', 'My first draft paragraph.');
    $first->assertJsonPath('essay.essay_words', 4);

    // A fresh request (simulating a later session) sees the same draft.
    $show = $this->actingAs($reviewer)->getJson("/api/speeches/{$review->speech_id}/essay?review_id={$review->id}");
    $show->assertOk();
    $show->assertJsonPath('essay.essay_html', '<p>My first draft paragraph.</p>');
    $show->assertJsonPath('essay.essay_lock_version', 1);

    expect($review->fresh()->essay_html)->toBe('<p>My first draft paragraph.</p>');
    expect($review->fresh()->essay_published_at)->toBeNull();
});

// 2. Speaker cannot read essay_html until essay_published_at is set.
it('hides essay_html from the speaker until the essay is published', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = essaySpeakerAndCoach();
    $review = essayAcceptedInProgressReview($speaker, $reviewer);

    $this->actingAs($reviewer)->putJson("/api/speeches/{$review->speech_id}/essay", [
        'html' => '<p>Secret draft the speaker must not see yet.</p>',
        'lock_version' => 0,
    ])->assertOk();

    $draftView = $this->actingAs($speaker)->getJson("/api/speeches/{$review->speech_id}/essay?review_id={$review->id}");
    $draftView->assertOk();
    $draftView->assertJsonPath('essay.essay_html', '');
    $draftView->assertJsonPath('essay.essay_text', null);

    $this->actingAs($reviewer)->postJson("/api/speeches/{$review->speech_id}/essay/publish")->assertOk();

    $publishedView = $this->actingAs($speaker)->getJson("/api/speeches/{$review->speech_id}/essay?review_id={$review->id}");
    $publishedView->assertOk();
    $publishedView->assertJsonPath('essay.essay_html', '<p>Secret draft the speaker must not see yet.</p>');
});

// 3. A second reviewer on the same speech cannot read the first reviewer's
//    essay by any route.
it('refuses a second reviewer on the same speech any read of the first reviewer\'s essay', function () {
    $this->seed(RoleSeeder::class);
    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewerA = User::factory()->create();
    $reviewerA->assignRole('coach');
    $reviewerB = User::factory()->create();
    $reviewerB->assignRole('coach');

    $speech = Speech::factory()->for($speaker)->create();
    $reviewA = essayAcceptedInProgressReview($speaker, $reviewerA, $speech);
    essayAcceptedInProgressReview($speaker, $reviewerB, $speech);

    $this->actingAs($reviewerA)->putJson("/api/speeches/{$reviewA->speech_id}/essay", [
        'html' => '<p>Reviewer A private essay.</p>',
        'lock_version' => 0,
    ])->assertOk();
    $this->actingAs($reviewerA)->postJson("/api/speeches/{$reviewA->speech_id}/essay/publish")->assertOk();

    // Direct API call against reviewer A's review_id, authenticated as
    // reviewer B — refused at the review-level readAnnotations gate, even
    // though the essay is published (publication only ever widens the
    // speaker's access, never a peer reviewer's).
    $this->actingAs($reviewerB)
        ->getJson("/api/speeches/{$reviewA->speech_id}/essay?review_id={$reviewA->id}")
        ->assertForbidden();

    // Nor can reviewer B write to reviewer A's essay by any route — the
    // write endpoints don't even accept a review_id, so this can only ever
    // touch reviewer B's own (empty) review.
    $this->actingAs($reviewerB)->putJson("/api/speeches/{$reviewA->speech_id}/essay", [
        'html' => '<p>Hijack attempt.</p>',
        'lock_version' => 0,
    ])->assertOk();

    expect($reviewA->fresh()->essay_html)->toBe('<p>Reviewer A private essay.</p>');
});

// 4. Stored-XSS payload written directly to the essay_html column, then
//    fetched via the read endpoint — the read-time sanitizer must
//    neutralize it even though the write-time sanitizer was bypassed.
it('neutralizes a stored-XSS payload on read even when it bypassed the write-time sanitizer', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = essaySpeakerAndCoach();
    $review = essayAcceptedInProgressReview($speaker, $reviewer);

    $hostilePayload = '<p>Hello</p><script>alert(document.cookie)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">click</a>';

    // Bypass EssayService entirely: a direct DB write, simulating a
    // pre-this-class row or a future write-time sanitizer bug.
    Review::query()->whereKey($review->id)->update([
        'essay_html' => $hostilePayload,
        'essay_published_at' => now(),
    ]);

    $response = $this->actingAs($reviewer)->getJson("/api/speeches/{$review->speech_id}/essay?review_id={$review->id}");
    $response->assertOk();

    $html = $response->json('essay.essay_html');
    expect($html)->not->toContain('<script');
    expect($html)->not->toContain('onerror');
    expect($html)->not->toContain('javascript:');
    expect($html)->not->toContain('<img');
    expect($html)->toContain('<p>Hello</p>');
});

// 5. clearAnnotations does not clear the essay.
it('leaves essay columns untouched when clearAnnotations empties the annotation set', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = essaySpeakerAndCoach();
    $review = essayAcceptedInProgressReview($speaker, $reviewer);

    $this->actingAs($reviewer)->putJson("/api/speeches/{$review->speech_id}/essay", [
        'html' => '<p>An essay that must survive clearAnnotations.</p>',
        'lock_version' => 0,
    ])->assertOk();
    $this->actingAs($reviewer)->postJson("/api/speeches/{$review->speech_id}/essay/publish")->assertOk();

    Annotation::factory()->for($review)->create(['published_at' => now()]);
    Annotation::factory()->for($review)->draft()->create();
    $review->update(['annotations_count' => 2, 'published_annotations_count' => 1]);

    $before = $review->fresh();

    $this->actingAs($reviewer)->deleteJson("/api/speeches/{$review->speech_id}/annotation-sets/me")
        ->assertNoContent();

    $after = $review->fresh();
    expect($after->annotations_count)->toBe(0);
    expect($after->published_annotations_count)->toBe(0);
    expect($after->essay_html)->toBe($before->essay_html);
    expect($after->essay_text)->toBe($before->essay_text);
    expect($after->essay_published_at?->equalTo($before->essay_published_at))->toBeTrue();
    expect($after->essay_updated_at?->equalTo($before->essay_updated_at))->toBeTrue();
    expect($after->essay_words)->toBe($before->essay_words);
    expect($after->essay_lock_version)->toBe($before->essay_lock_version);
});

// 6. A 30,000-word essay round-trips without truncation.
it('round-trips a 30,000-word essay without truncation', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = essaySpeakerAndCoach();
    $review = essayAcceptedInProgressReview($speaker, $reviewer);

    $words = [];
    for ($i = 0; $i < 30000; $i++) {
        $words[] = 'word'.$i;
    }
    $bodyText = implode(' ', $words);
    $html = '<p>'.$bodyText.'</p>';

    $response = $this->actingAs($reviewer)->putJson("/api/speeches/{$review->speech_id}/essay", [
        'html' => $html,
        'lock_version' => 0,
    ]);

    $response->assertOk();
    $response->assertJsonPath('essay.essay_words', 30000);

    $fresh = $review->fresh();
    expect($fresh->essay_words)->toBe(30000);
    expect(mb_strlen((string) $fresh->essay_html))->toBe(mb_strlen($html));
    expect($fresh->essay_html)->toBe($html);

    $show = $this->actingAs($reviewer)->getJson("/api/speeches/{$review->speech_id}/essay?review_id={$review->id}");
    $show->assertOk();
    expect(mb_strlen((string) $show->json('essay.essay_html')))->toBe(mb_strlen($html));
});

// 7. Admin cannot call essay.update/essay.publish.
it('forbids an admin from writing or publishing an essay even when a review row is forced under an admin id', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = essaySpeakerAndCoach();
    $admin = User::factory()->create();
    $admin->assignRole('admin');

    $review = essayAcceptedInProgressReview($speaker, $reviewer);
    $review->update(['reviewer_id' => $admin->id]); // forced, contrived — mirrors the annotation test's own shape

    expect(app(AnnotationPolicy::class)->essayUpdate($admin, $review->fresh()))->toBeFalse();
    expect(app(AnnotationPolicy::class)->essayPublish($admin, $review->fresh()))->toBeFalse();

    $this->actingAs($admin)->putJson("/api/speeches/{$review->speech_id}/essay", [
        'html' => '<p>Admin should never write this.</p>',
        'lock_version' => 0,
    ])->assertForbidden();

    $this->actingAs($admin)->postJson("/api/speeches/{$review->speech_id}/essay/publish")
        ->assertForbidden();

    expect($review->fresh()->essay_html)->toBeNull();

    // The ordinary case too: an admin holding no review at all 404s before
    // authorize() is even reached, same shape as AnnotationController.
    $ordinaryAdmin = User::factory()->create();
    $ordinaryAdmin->assignRole('admin');
    $review->update(['reviewer_id' => $reviewer->id]); // restore

    $this->actingAs($ordinaryAdmin)->putJson("/api/speeches/{$review->speech_id}/essay", [
        'html' => '<p>Should 404.</p>',
        'lock_version' => 0,
    ])->assertNotFound();
});
