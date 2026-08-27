<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Annotation\CreateVoiceAnnotationRequest;
use App\Http\Resources\AnnotationResource;
use App\Jobs\TranscribeVoiceNote;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Services\MediaUrlSigner;
use App\Services\ReviewService;
use App\Services\Voice\VoiceNoteService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class VoiceAnnotationController extends Controller
{
    public function store(CreateVoiceAnnotationRequest $request, Speech $speech, ReviewService $reviews, VoiceNoteService $notes): JsonResponse
    {
        $review = $reviews->findOwnReview($speech, $request->user());
        $this->authorize('voice.create', $review);
        [$annotation, $created] = $notes->create($review, $request->file('audio'), $request->validated());

        return new JsonResponse(['annotation' => new AnnotationResource($annotation)], $created ? 202 : 200);
    }

    public function audioUrl(Request $request, Speech $speech, Annotation $annotation, MediaUrlSigner $signer): JsonResponse
    {
        $review = $annotation->review()->with('speech')->firstOrFail();
        abort_unless($review->speech_id === $speech->id, Response::HTTP_NOT_FOUND);
        // 404, not `authorize()`'s 403: `$annotation` is implicit-bound with
        // no ownership scoping, and a PEER reviewer's annotation on this
        // same speech passes the speech_id check above — so a 403 here made
        // the authorization outcome itself an oracle. Walking ids against
        // this endpoint returned 403 for a peer's live voice note and 404
        // for a nonexistent id, revealing that the peer exists and how much
        // they recorded. Matches AnnotationController::update/destroy,
        // which resolve entitlement before any status-bearing branch.
        abort_unless(Gate::forUser($request->user())->allows('readAnnotations', $review), Response::HTTP_NOT_FOUND);

        $visible = Annotation::query()->whereKey($annotation->id)->visibleTo($request->user(), $review)->exists();
        abort_unless($visible, Response::HTTP_NOT_FOUND);
        $asset = $annotation->audioAsset()->first();
        abort_unless($asset !== null && $asset->speech_id === $speech->id && $asset->kind === 'voice_note', Response::HTTP_NOT_FOUND);
        if ($asset->status === 'processing') {
            return new JsonResponse(['message' => 'Voice note is still processing.'], Response::HTTP_CONFLICT);
        }
        if ($asset->status === 'failed') {
            return new JsonResponse(['message' => 'Voice note could not be processed.', 'failure_code' => $asset->failure_code], Response::HTTP_CONFLICT);
        }
        abort_unless($asset->status === 'ready', Response::HTTP_NOT_FOUND);

        return new JsonResponse(['audio' => ['url' => $signer->presign($asset->path), 'expires_at' => now()->addSeconds(MediaUrlSigner::DEFAULT_TTL_SECONDS)->toIso8601String()]]);
    }

    public function retryTranscript(Request $request, Speech $speech, Annotation $annotation, ReviewService $reviews): JsonResponse
    {
        // Entitlement resolved from the CALLER's own review, never from the
        // implicit-bound annotation: resolving the review off `$annotation`
        // and only checking `speech_id` let a peer reviewer's annotation
        // through to `authorize()`, whose 403 (vs 404 for a nonexistent id)
        // confirmed the peer's voice note exists. Same shape as
        // AnnotationController::update/destroy.
        $review = $reviews->findOwnReview($speech, $request->user());
        abort_unless($annotation->review_id === $review->id, Response::HTTP_NOT_FOUND);
        $annotation->setRelation('review', $review);
        $this->authorize('voice.retryTranscript', $annotation);

        $fresh = DB::transaction(function () use ($annotation): Annotation {
            $locked = Annotation::query()->with('audioAsset')->whereKey($annotation->id)->lockForUpdate()->firstOrFail();
            abort_unless($locked->audio_asset_id !== null && $locked->audioAsset?->status === 'ready', Response::HTTP_CONFLICT, 'Voice audio is not ready.');
            abort_unless($locked->transcript_status === 'failed', Response::HTTP_CONFLICT, 'Only a failed transcript can be retried.');
            $attempt = (string) Str::uuid();
            $locked->update(['transcript_status' => 'pending', 'transcript_failure_code' => null, 'transcript_attempt_id' => $attempt]);

            return $locked;
        });

        try {
            TranscribeVoiceNote::dispatch($fresh->id, (int) $fresh->audio_asset_id, (string) $fresh->transcript_attempt_id);
        } catch (\Throwable $exception) {
            Annotation::query()->whereKey($fresh->id)
                ->where('audio_asset_id', $fresh->audio_asset_id)
                ->where('transcript_attempt_id', $fresh->transcript_attempt_id)
                ->where('transcript_status', 'pending')
                ->update(['transcript_status' => 'failed', 'transcript_failure_code' => 'voice_transcription_failed']);
            throw $exception;
        }

        return new JsonResponse(['annotation' => new AnnotationResource($fresh)], Response::HTTP_ACCEPTED);
    }

    public function restore(Request $request, Speech $speech, string $annotation): JsonResponse
    {
        $snapshot = Annotation::withTrashed()->whereKey($annotation)->firstOrFail(['id', 'review_id', 'audio_asset_id']);
        abort_unless($snapshot->audio_asset_id !== null, Response::HTTP_NOT_FOUND);
        $reviewerId = $request->user()->id;
        $restored = DB::transaction(function () use ($speech, $annotation, $snapshot, $reviewerId): Annotation {
            // Match revokeAndPurge's review -> asset -> annotation order so
            // Undo cannot deadlock a concurrent hard purge on PostgreSQL.
            $review = Review::query()->whereKey($snapshot->review_id)->lockForUpdate()->firstOrFail();
            $asset = SpeechAsset::query()->whereKey($snapshot->audio_asset_id)->lockForUpdate()->firstOrFail();
            $locked = Annotation::withTrashed()->whereKey($annotation)->lockForUpdate()->firstOrFail();
            // `$review->reviewer_id === $reviewerId` is part of the 404
            // predicate, not left to `authorize()` below: without it a peer
            // reviewer's tombstoned voice note on this same speech reached
            // the gate and came back 403, while a nonexistent id came back
            // 404 — confirming the peer's note exists.
            abort_unless($review->reviewer_id === $reviewerId && $review->speech_id === $speech->id && $locked->review_id === $review->id && $locked->audio_asset_id === $asset->id, Response::HTTP_NOT_FOUND);
            $locked->setRelation('review', $review);
            $this->authorize('voice.restore', $locked);
            abort_unless($locked->trashed(), Response::HTTP_CONFLICT, 'Voice note is not deleted.');
            abort_unless($asset->purge_claim_id === null, Response::HTTP_CONFLICT, 'Voice note deletion is already being finalized.');
            $locked->restore();
            $review->increment('annotations_count');
            if ($locked->published_at !== null) {
                $review->increment('published_annotations_count');
            }

            return $locked->load('audioAsset');
        });

        return new JsonResponse(['annotation' => new AnnotationResource($restored)]);
    }
}
