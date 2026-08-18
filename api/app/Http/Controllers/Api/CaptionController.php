<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\SpeechDeletedException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Caption\UpdateCaptionSettingsRequest;
use App\Http\Requests\Caption\UpdateCaptionsRequest;
use App\Http\Resources\CaptionResource;
use App\Http\Resources\SpeechResource;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Services\Captions\CaptionService;
use App\Services\Captions\EnsureCaptionJob;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-09-captions.md / the frozen STEP-09 backend contract §1, §4:
 * `GET`/`PUT /speeches/{speech}/captions`. No optimistic-locking / 409
 * conflict handling here (the contract is explicit: "single-speaker VTT
 * editing... has no concurrent-writer scenario to guard against. Do not
 * add one uninvited") — unlike EssayController/AnnotationController, there
 * is no `lock_version` anywhere in this class.
 */
class CaptionController extends Controller
{
    /**
     * `GET /speeches/{speech}/captions`. `readCaptions` (owner OR an
     * access-granting reviewer, per SpeechPolicy::readCaptions) — a
     * reviewer coaching a speech needs to read captions the same as they
     * can watch the video.
     *
     * When no `captions` asset exists yet for this speech (captions were
     * off at upload time, or nothing has been generated or hand-written
     * yet), this returns the honest empty state (`status: 'unavailable'`,
     * `vtt: null`) rather than a 404 — "captions don't exist yet" is a
     * legitimate, expected state for a freshly-uploaded speech, not an
     * error, mirroring the empty-state philosophy STEP-05/06/08 already
     * use elsewhere in this codebase (e.g. EssayController's unpublished-
     * essay masking).
     */
    public function show(Request $request, string $speech): JsonResponse
    {
        $speechModel = $this->resolveSpeech($speech);

        $this->authorize('caption.readCaptions', $speechModel);

        $captionsAsset = SpeechAsset::query()
            ->where('speech_id', $speechModel->id)
            ->where('kind', 'captions')
            ->first();

        return new JsonResponse([
            'captions' => new CaptionResource($this->toResourceArray($captionsAsset)),
        ]);
    }

    /**
     * `PUT /speeches/{speech}/captions`. Ownership-only
     * (`SpeechPolicy::updateCaptions`, registered as `caption.update`).
     * `UpdateCaptionsRequest` already ran server-side VTT validation
     * (422 on malformed VTT) before this method is ever reached.
     */
    public function update(UpdateCaptionsRequest $request, string $speech, CaptionService $captions): JsonResponse
    {
        $speechModel = $this->resolveSpeech($speech);

        $this->authorize('caption.update', $speechModel);

        $captionsAsset = $captions->update($speechModel, (string) $request->validated('vtt'));

        return new JsonResponse([
            'captions' => new CaptionResource($this->toResourceArray($captionsAsset)),
        ]);
    }

    /**
     * `PATCH /speeches/{speech}/caption-settings`. Ownership-only, same
     * `caption.update` gate as `PUT /captions` — flipping the automatic-
     * captioning off-switch is a speaker act, not a reviewer or admin one
     * (see SpeechPolicy::updateCaptions's own docblock; no new policy
     * method needed since this is the identical ownership check).
     *
     * All the actual state-machine logic (the frozen table in the task
     * brief) lives in App\Services\Captions\EnsureCaptionJob — this method
     * is just the HTTP boundary: authorize, call the right service method,
     * return the fresh speech so the frontend's optimistic-update/refetch
     * has the real `captions_enabled` value without a second round trip.
     */
    public function updateSettings(UpdateCaptionSettingsRequest $request, string $speech, EnsureCaptionJob $captions): JsonResponse
    {
        $speechModel = $this->resolveSpeech($speech);

        $this->authorize('caption.update', $speechModel);

        $enabled = (bool) $request->validated('captions_enabled');

        if ($enabled) {
            $captions->enable($speechModel);
        } else {
            $captions->disable($speechModel);
        }

        return new JsonResponse([
            'speech' => new SpeechResource($speechModel->fresh()),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function toResourceArray(?SpeechAsset $captionsAsset): array
    {
        if ($captionsAsset === null) {
            return [
                'status' => 'unavailable', 'vtt' => null, 'failure_code' => null,
                'updated_at' => null, 'asset_id' => null, 'revision' => null,
            ];
        }

        $vtt = $captionsAsset->status === 'ready'
            ? Storage::disk($captionsAsset->disk)->get($captionsAsset->path)
            : null;

        return [
            'status' => $captionsAsset->status,
            'vtt' => $vtt,
            'failure_code' => $captionsAsset->failure_code,
            'updated_at' => $captionsAsset->updated_at,
            'asset_id' => $captionsAsset->id,
            'revision' => $captionsAsset->content_revision,
        ];
    }

    /**
     * Identical to EssayController::resolveSpeech() — 410 Gone (not 404)
     * for a speech id that WAS found but is soft-deleted, same status-code
     * surface as every other speech-scoped route family.
     */
    private function resolveSpeech(string $speechId): Speech
    {
        /** @var Speech $speech */
        $speech = Speech::withTrashed()->findOrFail($speechId);

        if ($speech->trashed()) {
            throw new SpeechDeletedException;
        }

        return $speech;
    }
}
