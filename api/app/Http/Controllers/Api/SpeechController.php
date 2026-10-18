<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\SpeechAccessDeniedException;
use App\Exceptions\SpeechDeletedException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Speech\CreateSpeechRequest;
use App\Http\Requests\Speech\UpdateSpeechRequest;
use App\Http\Resources\SpeechResource;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Services\SpeechDeletionService;
use App\Services\SpeechService;
use Closure;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * "My speeches" and single-speech read/create. `show` is a four-tier read:
 * non-existence and "never had a review here" both 404 (don't confirm
 * existence to a stranger); a caller whose review no longer reaches the
 * speech — revoked, declined or abandoned — gets 403 (they were invited, so
 * existence is not news to them; see SpeechAccessDeniedException, added by
 * PLAN-ACCESS-DENIED-STATES.md, which also explains why those three are not
 * told apart); an invited-but-not-yet-accepted reviewer gets a reduced
 * metadata payload (no signed playback URL — that still lives behind
 * SpeechUploadController::playbackUrl, gated separately by an
 * access-granting review); and the owner or an access-granting reviewer gets
 * the full payload this endpoint always returned pre-S5.
 */
class SpeechController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $speeches = $this->currentUser($request)->speeches()
            ->with(self::eagerLoads())
            ->latest()
            ->paginate(20);

        return new JsonResponse([
            'speeches' => SpeechResource::collection($speeches),
            'meta' => [
                'current_page' => $speeches->currentPage(),
                'last_page' => $speeches->lastPage(),
                'total' => $speeches->total(),
            ],
        ]);
    }

    public function store(CreateSpeechRequest $request, SpeechService $speeches): JsonResponse
    {
        $validated = $request->validated();
        $attributes = ['title' => (string) $validated['title']];
        if (array_key_exists('description', $validated)) {
            $attributes['description'] = $validated['description'] === null ? null : (string) $validated['description'];
        }
        if (array_key_exists('delivered_on', $validated)) {
            $attributes['delivered_on'] = $validated['delivered_on'] === null ? null : (string) $validated['delivered_on'];
        }
        if (array_key_exists('supersedes_id', $validated)) {
            $attributes['supersedes_id'] = $validated['supersedes_id'] === null ? null : (int) $validated['supersedes_id'];
        }
        if (array_key_exists('change_note', $validated)) {
            $attributes['change_note'] = $validated['change_note'] === null ? null : (string) $validated['change_note'];
        }
        if (array_key_exists('captions_enabled', $validated)) {
            $attributes['captions_enabled'] = (bool) $validated['captions_enabled'];
        }

        $speech = $speeches->create($this->currentUser($request), $attributes);

        return new JsonResponse([
            'speech' => new SpeechResource($speech->load(self::eagerLoads())),
        ], Response::HTTP_CREATED);
    }

    public function show(Request $request, Speech $speech): JsonResponse
    {
        $user = $this->currentUser($request);
        $isOwner = $speech->user_id === $user->id;

        // §7.3's own review row (if any) drives both tiers below — one
        // query, reused, rather than a visibility EXISTS check plus a
        // second separate query for the row's own status.
        //
        // PLAN-ACCESS-DENIED-STATES.md §2.2: deliberately NO
        // `whereNull('revoked_at')` here any more. `uq_reviews_speech_reviewer`
        // (a real unique index, see the reviews migration) guarantees at most
        // one row per (speech, reviewer), and ReviewService::invite clears the
        // tombstone IN PLACE on re-invite rather than inserting a second row —
        // so dropping the filter cannot shadow a live grant, and there is
        // nothing to order by. Keeping the revoked row visible is precisely
        // what lets the denied tier below tell the truth instead of handing a
        // former reviewer the stranger's 404.
        $review = $isOwner ? null : Review::query()
            ->where('speech_id', $speech->id)
            ->where('reviewer_id', $user->id)
            ->first();

        $isLive = $review !== null && $review->revoked_at === null;
        $isGranting = $isLive && in_array($review->status, Review::ACCESS_GRANTING, true);

        // Never held a review here at all — or held one that was
        // revoke-and-purged, which hard-deletes the row and so correctly
        // returns this caller to stranger status. Don't confirm existence.
        // Unchanged from STEP-05 §7.3, and pinned by name in
        // ReviewInvitationHttpTest's "refuses a stranger with 404, not 403".
        if (! $isOwner && $review === null) {
            return new JsonResponse(['message' => 'No such speech.'], Response::HTTP_NOT_FOUND);
        }

        // Holds a row that no longer reaches the speech: revoked, declined or
        // abandoned. 403, not 404 — see SpeechAccessDeniedException for why,
        // including why all three collapse to one undifferentiated refusal
        // rather than being told apart.
        if (! $isOwner && ! $isGranting && ! ($isLive && $review->status === 'invited')) {
            throw new SpeechAccessDeniedException;
        }

        if ($isOwner || $isGranting) {
            return new JsonResponse([
                'speech' => new SpeechResource($speech->load(self::eagerLoads())),
            ]);
        }

        // Invited but not yet accepted: reduced metadata tier only —
        // title, duration, speaker's name, the invitation message. No
        // signed playback URL.
        $speech->loadMissing('user');

        return new JsonResponse([
            'speech' => [
                'id' => $speech->id,
                'ulid' => $speech->ulid,
                'title' => $speech->title,
                'duration_seconds' => $speech->duration_seconds,
                'speaker_name' => trim("{$speech->user->first_name} {$speech->user->last_name}"),
                'invitation_message' => $review->invitation_message,
                'review_status' => $review->status,
            ],
        ]);
    }

    /**
     * `PATCH /speeches/{speech}`. IMPLEMENTATION-PLANS.md §7.5.6/§7.5.7(b).
     *
     * ⚠️ The information-leak trap: this ability (`speech.update`) is PURE
     * ownership — there is no reviewer-tier branch that ever passes, unlike
     * `show()`'s four tiers above. But the same two-way split `show()`
     * applies to a non-owner still has to apply here, or a write reveals
     * existence where the read does not:
     *
     *  - A caller who is not the owner AND has never had any review row at
     *    all on this speech (regardless of that row's status/revoked
     *    state) gets the same 404 a genuine stranger gets from `show()` —
     *    `$this->authorize()` must NOT run first for this case, since
     *    Laravel's default 403 would leak existence to a stranger.
     *  - Anyone else (the owner, or a non-owner who holds ANY review row,
     *    even a revoked/declined one — they already structurally know this
     *    speech exists) goes through `$this->authorize('speech.update', ...)`
     *    normally, which correctly 403s any non-owner since the ability is
     *    ownership-only.
     */
    public function update(UpdateSpeechRequest $request, string $speech): JsonResponse
    {
        $speechModel = $this->resolveSpeechForWriter($speech, $this->currentUser($request));

        if ($speechModel === null) {
            return new JsonResponse(['message' => 'No such speech.'], Response::HTTP_NOT_FOUND);
        }

        $this->authorize('speech.update', $speechModel);

        $validated = $request->validated();
        $attributes = [];
        if (array_key_exists('title', $validated)) {
            $attributes['title'] = (string) $validated['title'];
        }
        if (array_key_exists('description', $validated)) {
            $attributes['description'] = $validated['description'] === null ? null : (string) $validated['description'];
        }
        if (array_key_exists('delivered_on', $validated)) {
            $attributes['delivered_on'] = $validated['delivered_on'] === null ? null : (string) $validated['delivered_on'];
        }
        if (array_key_exists('change_note', $validated)) {
            $attributes['change_note'] = $validated['change_note'] === null ? null : (string) $validated['change_note'];
        }

        $speechModel->update($attributes);

        // refresh() (`static`, non-nullable), not fresh() (`static|null` —
        // phpstan correctly refuses chaining ->load() off a nullable
        // return): this is the same row this method just updated, so there
        // is no "deleted out from under us" case fresh() exists to answer.
        return new JsonResponse([
            'speech' => new SpeechResource($speechModel->refresh()->load(self::eagerLoads())),
        ]);
    }

    /**
     * `DELETE /speeches/{speech}`. IMPLEMENTATION-PLANS.md §7.5.6/§7.5.7(b).
     * Same stranger-vs-structurally-aware split as `update()` above, same
     * reasoning — see that method's docblock.
     */
    public function destroy(Request $request, string $speech, SpeechDeletionService $deletions): JsonResponse
    {
        $speechModel = $this->resolveSpeechForWriter($speech, $this->currentUser($request));

        if ($speechModel === null) {
            return new JsonResponse(['message' => 'No such speech.'], Response::HTTP_NOT_FOUND);
        }

        $this->authorize('speech.delete', $speechModel);

        $deletions->deleteOwn($speechModel);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    /**
     * Shared by `update()`/`destroy()` — factored out of what was
     * previously two verbatim copies of the same stranger-vs-known-caller
     * split (a code-review finding: a future change to the tiering rule
     * applied to one copy and not the other would silently reopen the
     * existence leak this method exists to close).
     *
     * code-review finding, fixed here: the original version called
     * `CaptionController::resolveSpeech()`'s 410-Gone check FIRST and the
     * stranger-tier check second — so a genuine stranger probing a speech
     * id that had since been deleted got 410 (not the documented 404),
     * distinguishably different from a never-existed id's 404 and from a
     * live speech they have no relation to's "No such speech" 404. That
     * let any authenticated user enumerate which speech ids used to exist
     * and were deleted — exactly the leak `update()`'s own docblock says
     * `$this->authorize()` must not cause, just via a different code path.
     * The ordering now is: resolve the row (still 404 for a truly
     * nonexistent id, via `findOrFail()`), THEN decide the caller's tier,
     * THEN — only for a caller who already structurally knows the speech
     * exists (the owner, or anyone who ever held a review on it) — decide
     * whether a trashed row reads as 410. A genuine stranger gets the same
     * 404 regardless of whether the row is live or trashed, so trashed
     * state is never observable to them.
     *
     * Returns `null` for a stranger (caller returns the generic 404);
     * throws `SpeechDeletedException` (410) for a known caller hitting an
     * already-deleted speech; returns the live `Speech` otherwise. The
     * route parameter must stay typed `string $speech`, NOT an implicitly
     * route-model-bound `Speech $speech`: implicit binding applies the
     * `SoftDeletes` global scope and would 404 a trashed speech before
     * this method ever ran, which is the wrong status code for the
     * known-caller case.
     */
    private function resolveSpeechForWriter(string $speech, User $user): ?Speech
    {
        /** @var Speech $speechModel */
        $speechModel = Speech::withTrashed()->findOrFail($speech);

        $isOwner = $speechModel->user_id === $user->id;
        $hasReviewRow = ! $isOwner && Review::query()
            ->where('speech_id', $speechModel->id)
            ->where('reviewer_id', $user->id)
            ->exists();

        if (! $isOwner && ! $hasReviewRow) {
            return null;
        }

        if ($speechModel->trashed()) {
            throw new SpeechDeletedException;
        }

        return $speechModel;
    }

    /**
     * `assets` here is deliberately scoped to `kind IN ('poster','sprite')`
     * — SpeechResource's poster/sprite blocks (§9.5) need those rows, but a
     * blanket `with('assets')` would also drag in every `source`/`captions`
     * row this endpoint never serializes. `primaryVideo` stays a separate
     * named eager-load (unchanged from STEP-03) rather than folding video
     * into the same constrained `assets` load, since SpeechResource still
     * reads `primary_video` off that relation specifically.
     *
     * @return array<int|string, string|Closure(Relation<*, *, *>): mixed>
     */
    private static function eagerLoads(): array
    {
        return [
            'primaryVideo',
            'supersedes',
            // Typed against the base `Relation` (not `HasMany`), matching
            // `with()`'s own closure signature — at runtime this is always
            // called with the `assets` HasMany, since the key it's keyed
            // under here is the relation name itself.
            'assets' => fn (Relation $query) => $query->whereIn('kind', ['poster', 'sprite']),
        ];
    }
}
