<?php

use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\DB;

/**
 * IMPLEMENTATION-PLANS.md §7.7.8 — "Backend: two tests, no production code."
 *
 * ⚠️ §7.7.8's own text is explicit that "the three flagship endpoints" is
 * never enumerated anywhere in MODERNIZATION_PLAN.md (six hits for
 * "flagship", none naming them) — it is an INFERENCE from the three
 * *screens* STEP-15 names (annotation authoring, playback, profile), and
 * that inference must be confirmed, not silently built on. This docblock
 * is that confirmation.
 *
 * Confirmed by reading `routes/api.php` directly (not by trusting the
 * brief's names):
 *
 *   - `GET /speeches/{speech}/annotations`  — routes/api.php:154, ->
 *     AnnotationController::index. The annotation-authoring/playback
 *     screen's commentary list — STEP-06/STEP-07's "watch commentary" /
 *     "write commentary" surface, and the coach-side `AnnotationList`
 *     §7.7.1 settles on as the authoritative accessible surface.
 *   - `GET /speeches/{speech}`               — routes/api.php:105, ->
 *     SpeechController::show. The speech-detail/playback screen's own
 *     metadata fetch (poster, sprite, primary video, supersedes badge).
 *   - `GET /u/{username}/timeline`          — routes/api.php:305, ->
 *     ProfileTimelineController::show. The public profile-timeline
 *     screen — the third of STEP-15's three named screens.
 *
 * All three names in the task brief turned out to be the ACTUAL routes
 * verbatim (confirmed against routes/api.php and each controller's own
 * docblock) — no relabeling was needed. This matches §7.7's own framing
 * of these three screens (annotation, playback, profile) as the surfaces
 * the accessibility pass is built around, so no fourth/different
 * candidate was more obviously "flagship" than these three.
 *
 * Grouping: 2 tests for 3 endpoints, per §7.7.8's instruction.
 * `GET /speeches/{speech}/annotations` and `GET /speeches/{speech}` are
 * grouped into ONE test because they are the two requests the same
 * annotation-authoring/playback screen load fires together (the track's
 * commentary list plus the speech's own metadata/poster/video) — an
 * N+1 introduced in either request degrades that one screen. The
 * profile-timeline endpoint is a separate screen entirely (a different
 * viewer context: browsing a profile, not an open speech) and gets its
 * own test.
 *
 * Idiom copied from `tests/Feature/Connection/ConnectionRailQueryCountTest.php`:
 * `DB::enableQueryLog()` around the request, then assert BOTH (a) a
 * query shaped like the intended batched load exists, and (b) the TOTAL
 * count of queries touching each relevant table — the second assertion
 * is the one that recorded lesson is about: a naive per-row
 * implementation (e.g. reading `$annotation->audioAsset` without the
 * controller's `with('audioAsset')`, or replacing a constrained
 * `with('assets', ...)` with a per-kind lazy fetch) would not necessarily
 * match a "shaped like the intended query" substring filter, and would
 * silently slip past a check that only verifies the happy-path query
 * exists. Every fixture below seeds MORE THAN ONE row on the "many" side
 * so a regression would actually surface as more-than-one query, not
 * just a different query shape.
 */
it('loads the annotation-authoring and speech-detail screens without N+1 queries', function () {
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewerA = User::factory()->create();
    $reviewerA->assignRole('coach');
    $reviewerB = User::factory()->create();
    $reviewerB->assignRole('coach');

    $speech = Speech::factory()->for($speaker)->create();

    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewerA->id,
        'speech_owner_id' => $speaker->id,
    ]);

    // A second reviewer on the SAME speech — the real shape of this
    // screen (a speech usually has more than one coach attached), kept
    // here so a future change that joins across every review on the
    // speech (instead of just the caller's own) would change the counts
    // below and be caught, even though this endpoint is scoped to one
    // review per request.
    Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewerB->id,
        'speech_owner_id' => $speaker->id,
    ]);

    // Two plain text annotations.
    Annotation::factory()->for($review)->create(['start_seconds' => 1.0]);
    Annotation::factory()->for($review)->create(['start_seconds' => 2.0]);

    // Three voice annotations, each with its OWN `speech_assets` row via
    // `audio_asset_id` — the "more than one of the many side" fixture:
    // AnnotationService::forReview()'s `->with('audioAsset')` must batch
    // all three into ONE `speech_assets` query. A naive regression (e.g.
    // AnnotationResource reading `$this->audioAsset` without the eager
    // load, or without its existing `relationLoaded('audioAsset')` guard)
    // would turn this into one `speech_assets` SELECT PER voice
    // annotation — 3, not 1 — here.
    $voiceAssetA = SpeechAsset::factory()->voiceNote()->create(['speech_id' => $speech->id]);
    $voiceAssetB = SpeechAsset::factory()->voiceNote()->create(['speech_id' => $speech->id]);
    $voiceAssetC = SpeechAsset::factory()->voiceNote()->create(['speech_id' => $speech->id]);
    Annotation::factory()->for($review)->create(['start_seconds' => 3.0, 'audio_asset_id' => $voiceAssetA->id, 'transcript_status' => 'ready']);
    Annotation::factory()->for($review)->create(['start_seconds' => 4.0, 'audio_asset_id' => $voiceAssetB->id, 'transcript_status' => 'ready']);
    Annotation::factory()->for($review)->create(['start_seconds' => 5.0, 'audio_asset_id' => $voiceAssetC->id, 'transcript_status' => 'ready']);

    DB::enableQueryLog();
    $annotationsResponse = $this->actingAs($reviewerA)
        ->getJson("/api/speeches/{$speech->id}/annotations?review_id={$review->id}");
    $annotationsLog = DB::getQueryLog();
    DB::disableQueryLog();

    $annotationsResponse->assertOk();
    expect(count($annotationsResponse->json('annotations')))->toBe(5);

    // Shape: the one `annotations` SELECT the service issues.
    $annotationsShaped = collect($annotationsLog)->filter(
        fn ($entry) => str_contains($entry['query'], 'select') && str_contains($entry['query'], 'annotations')
    );
    expect($annotationsShaped)->toHaveCount(1);

    // Total, tighter than the shape check above: EVERY query touching
    // `annotations` at all, regardless of shape — exactly 1, for all 5
    // rows. (`reviews`'s own `annotations_count` / `published_annotations_count`
    // columns never appear as literal column names in a `select *`, so
    // they cannot inflate this count.)
    $annotationsTouching = collect($annotationsLog)->filter(fn ($entry) => str_contains($entry['query'], 'annotations'));
    expect($annotationsTouching)->toHaveCount(1);

    // The N+1 this test exists to catch (see docblock above): exactly 1
    // query touches `speech_assets`, not 3 (one per voice annotation).
    $speechAssetsOnAnnotations = collect($annotationsLog)->filter(fn ($entry) => str_contains($entry['query'], 'speech_assets'));
    expect($speechAssetsOnAnnotations)->toHaveCount(1);

    // Now the speech-detail half of the same screen load. Seed several
    // poster variants plus a sprite and a primary video — the "many"
    // fixture on the `speech_assets` side for THIS request, so that
    // SpeechController::eagerLoads()'s constrained `assets` relation
    // (kind IN poster/sprite) proves it stays ONE query regardless of
    // how many such rows exist, not one per asset.
    SpeechAsset::factory()->video()->ready()->create(['speech_id' => $speech->id]);
    SpeechAsset::factory()->poster()->create(['speech_id' => $speech->id, 'status' => 'ready', 'is_primary' => true]);
    SpeechAsset::factory()->poster()->create(['speech_id' => $speech->id, 'status' => 'ready', 'is_primary' => false, 'width' => 640]);
    SpeechAsset::factory()->sprite()->create(['speech_id' => $speech->id, 'status' => 'ready']);

    // `disableQueryLog()` above does NOT clear the accumulated log (only
    // `enableQueryLog()`/`disableQueryLog()` toggle the flag; the log
    // itself persists until flushed) — without this, the counts below
    // would silently include every query from the annotations request
    // too.
    DB::flushQueryLog();
    DB::enableQueryLog();
    $showResponse = $this->actingAs($reviewerA)->getJson("/api/speeches/{$speech->id}");
    $showLog = DB::getQueryLog();
    DB::disableQueryLog();

    $showResponse->assertOk();
    expect($showResponse->json('speech.poster'))->not->toBeNull();

    // `reviews`: exactly the ONE row SpeechController::show looks up to
    // decide the caller's access tier (`$review = Review::query()->...->first()`)
    // — unaffected by $reviewerB's unrelated review existing on the same
    // speech.
    $reviewsOnShow = collect($showLog)->filter(fn ($entry) => str_contains($entry['query'], 'reviews'));
    expect($reviewsOnShow)->toHaveCount(1);

    // `speech_assets`: exactly TWO queries — `primaryVideo` (a `HasOne`)
    // and the constrained `assets` (a `HasMany`, kind IN poster/sprite)
    // are two SEPARATE eager loads against the same table, but each one
    // is already a single batched query regardless of row count. Seeding
    // 4 `speech_assets` rows above (video + 2 posters + sprite) and still
    // getting exactly 2 — not 4, not 6 — is what proves neither eager
    // load degrades into one-query-per-asset.
    $speechAssetsOnShow = collect($showLog)->filter(fn ($entry) => str_contains($entry['query'], 'speech_assets'));
    expect($speechAssetsOnShow)->toHaveCount(2);
});

/**
 * The profile-timeline screen. See the file-level docblock for why this
 * is a separate test from the one above (a different screen/viewer
 * context) and for the confirmed route (`GET /u/{username}/timeline`,
 * routes/api.php:305 -> ProfileTimelineController::show).
 *
 * The fixture seeds FOUR access-granting reviews so the viewer's
 * timeline has more than one row (the base "many" dimension every
 * fixture in this file uses) — two plain speeches and two that are each
 * the second entry in a 2-deep supersedes chain. That split matters
 * because ProfileTimelineController::show has a genuine, DOCUMENTED
 * per-row cost that is NOT a bug: `SpeechArcService::chainFor()` runs
 * only `when ($row->supersedes_id !== null)` (the controller's own
 * comment: "Only computed when this speech is actually part of a
 * chain"), so it is called once per CHAINED row, not once per timeline
 * row. Pinning the exact count below protects that intentional,
 * bounded-by-chain-membership shape from accidentally becoming
 * unconditional (which would silently double the query count for every
 * non-chained speech on every profile) or, in the other direction, from
 * growing a THIRD query per chain call without anyone noticing.
 */
it('loads the public-profile timeline in a bounded, chain-aware number of queries', function () {
    $viewer = User::factory()->create();
    $profileUser = User::factory()->create(['username' => 'flagship-profile']);

    // Two plain (non-chained) speeches.
    $speechC = Speech::factory()->for($profileUser)->create(['title' => 'Plain speech C']);
    Review::factory()->for($speechC)->create(['reviewer_id' => $viewer->id, 'speech_owner_id' => $profileUser->id, 'status' => 'published']);

    $speechD = Speech::factory()->for($profileUser)->create(['title' => 'Plain speech D']);
    Review::factory()->for($speechD)->create(['reviewer_id' => $viewer->id, 'speech_owner_id' => $profileUser->id, 'status' => 'published']);

    // Chain A: v1A -> v2A. The viewer holds a review only on v2A (the
    // newer attempt) — the same shape as the existing arc coverage in
    // ProfileTimelineTest.php — so v2A.supersedes_id triggers chainFor().
    $v1A = Speech::factory()->for($profileUser)->create(['title' => 'Chain A attempt 1']);
    $v2A = Speech::factory()->for($profileUser)->create(['title' => 'Chain A attempt 2', 'supersedes_id' => $v1A->id]);
    Review::factory()->for($v2A)->create(['reviewer_id' => $viewer->id, 'speech_owner_id' => $profileUser->id, 'status' => 'published']);

    // Chain B: v1B -> v2B, independent of chain A.
    $v1B = Speech::factory()->for($profileUser)->create(['title' => 'Chain B attempt 1']);
    $v2B = Speech::factory()->for($profileUser)->create(['title' => 'Chain B attempt 2', 'supersedes_id' => $v1B->id]);
    Review::factory()->for($v2B)->create(['reviewer_id' => $viewer->id, 'speech_owner_id' => $profileUser->id, 'status' => 'published']);

    DB::enableQueryLog();
    $response = $this->actingAs($viewer)->getJson('/api/u/flagship-profile/timeline');
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    $response->assertOk();
    $timeline = collect($response->json('timeline'));
    expect($timeline)->toHaveCount(4);

    // Confirms the fixture actually exercised both code paths: exactly 2
    // rows carry a non-null `arc` (the chained ones) and 2 carry null.
    expect($timeline->filter(fn ($item) => $item['arc'] !== null))->toHaveCount(2);
    expect($timeline->filter(fn ($item) => $item['arc'] === null))->toHaveCount(2);

    // `reviews`: the ONE main combined query (reviews JOIN speeches LEFT
    // JOIN speech_assets) touches `reviews` directly, PLUS one more per
    // chained row — `chainFor()`'s `Speech::query()->visibleTo($viewer)->whereIn(...)`
    // call embeds a `WHERE EXISTS (... FROM reviews ...)` subquery (see
    // `Speech::scopeVisibleTo`). 2 chained rows -> 1 + 2 = 3. If this
    // number grows, either the main query stopped being one combined
    // query, or a chain call started consulting `reviews` more than once.
    $reviewsTouching = collect($log)->filter(fn ($entry) => str_contains($entry['query'], 'reviews'));
    expect($reviewsTouching)->toHaveCount(3);

    // `speeches`: the main query (1) + per chained row, TWO queries each
    // — the recursive CTE (`FROM speeches ... JOIN speeches`) and the
    // `visibleTo` + `whereIn` + `pluck('id')` lookup (also against
    // `speeches`). 2 chained rows -> 1 + (2 x 2) = 5. This is the number
    // that would balloon if `chainFor()` ever stopped being a single
    // recursive query per call and started walking the chain with one
    // query per depth level instead.
    $speechesTouching = collect($log)->filter(fn ($entry) => str_contains($entry['query'], 'speeches'));
    expect($speechesTouching)->toHaveCount(5);

    // `speech_assets`: exactly 1 — the main query's own `LEFT JOIN
    // speech_assets AS poster`, which is already batched across all 4
    // timeline rows regardless of how many have a poster at all.
    // `chainFor()` never touches this table. If this grows, something
    // started resolving posters per timeline row instead of via the
    // single join.
    $speechAssetsTouching = collect($log)->filter(fn ($entry) => str_contains($entry['query'], 'speech_assets'));
    expect($speechAssetsTouching)->toHaveCount(1);
});
