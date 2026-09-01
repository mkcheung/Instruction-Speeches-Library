<?php

use App\Http\Controllers\Api\AccountController;
use App\Http\Controllers\Api\AnnotationController;
use App\Http\Controllers\Api\AvatarController;
use App\Http\Controllers\Api\CaptionController;
use App\Http\Controllers\Api\CoachApplicationController;
use App\Http\Controllers\Api\ConnectionController;
use App\Http\Controllers\Api\EraseSelfController;
use App\Http\Controllers\Api\EssayController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\OnboardingController;
use App\Http\Controllers\Api\PresignController;
use App\Http\Controllers\Api\PrivacyExportController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\ProfileTimelineController;
use App\Http\Controllers\Api\QueueStatusController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\ReviewController;
use App\Http\Controllers\Api\ReviewerDirectoryController;
use App\Http\Controllers\Api\SpeechController;
use App\Http\Controllers\Api\SpeechUploadController;
use App\Http\Controllers\Api\TranscriptController;
use App\Http\Controllers\Api\VoiceAnnotationController;
use App\Http\Controllers\Api\VoicePreferenceController;
use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class)->name('api.health');

// Spike-wall only (S0). P0 fix (PLAN-APP-HEADER.md): this route was
// unauthenticated and signed arbitrary storage paths — reachable by anyone,
// no credentials needed, bypassing SpeechUploadController::authorizeGrantingAccess
// entirely. It now requires a session, and PresignController itself 404s
// unless both halves of the env/opt-in guard pass, mirroring the frontend's
// double guard (web/src/lib/spikes-guard.ts) — see the controller for why
// the guard lives there and not here.
Route::middleware('auth:sanctum')
    ->get('/spikes/presign', PresignController::class)
    ->name('api.spikes.presign');

// Fortify's own routes (register/login/logout/forgot-password/reset-password/
// email verification) are registered by Laravel\Fortify\FortifyServiceProvider
// itself against the `web` middleware group, root-mounted (config/fortify.php
// `prefix` => '') to match the frontend's web/src/lib/api.ts +
// authApi.ts. docker/nginx/default.conf has explicit location blocks
// proxying these exact root paths to php-fpm alongside `/api`. Every JSON
// response contract for them is hand-bound in
// App\Providers\FortifyServiceProvider and app/Http/Responses/Fortify/*.

// account-only gate (§6.5): browsing/editing own (possibly incomplete) profile.
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/me', fn (Request $request): JsonResponse => new JsonResponse([
        'user' => new UserResource($request->user()->load('profile')),
    ]))->name('api.me');
    Route::delete('/me', EraseSelfController::class)->middleware('verified.api')->name('api.me.erase');

    Route::get('/onboarding', [OnboardingController::class, 'show'])->name('api.onboarding.show');
    Route::post('/onboarding/step-1', [OnboardingController::class, 'stepOne'])->name('api.onboarding.step1');
    Route::post('/onboarding/step-2', [OnboardingController::class, 'stepTwo'])->name('api.onboarding.step2');
    Route::post('/onboarding/step-3', [OnboardingController::class, 'stepThree'])->name('api.onboarding.step3');

    Route::patch('/profile', [ProfileController::class, 'updateSelf'])->name('api.profile.update');
    Route::patch('/profile/username', [ProfileController::class, 'updateUsername'])->name('api.profile.username');
    Route::post('/avatar', [AvatarController::class, 'update'])->name('api.avatar.update');
    Route::get('/me/preferences/voice-commentary/{speech}', [VoicePreferenceController::class, 'show'])
        ->middleware('verified.api')
        ->name('api.me.preferences.voice-commentary.show');
    Route::patch('/me/preferences/voice-commentary/{speech}', [VoicePreferenceController::class, 'update'])
        ->middleware('verified.api')
        ->name('api.me.preferences.voice-commentary.update');

    // STEP-03-upload-and-watch.md (§9, §6.11): upload and watch. Ownership
    // is checked inline in each controller method, not via a Policy — no
    // Policy classes exist in this codebase yet (matches S1/S2's pattern).
    Route::get('/speeches', [SpeechController::class, 'index'])->name('api.speeches.index');
    Route::post('/speeches', [SpeechController::class, 'store'])->name('api.speeches.store');

    // STEP-09-captions.md / the frozen STEP-09 backend contract §4:
    // MUST be registered before `/speeches/{speech}` below, or Laravel's
    // route matcher would swallow the literal `search` segment as the
    // `{speech}` route parameter instead. Scoped to the caller's OWN
    // speeches only (see TranscriptController::search's own doc comment)
    // — not speech-scoped in the URL itself, since it queries across every
    // speech a user owns, not one.
    Route::get('/speeches/search', [TranscriptController::class, 'search'])->name('api.speeches.search');

    Route::get('/speeches/{speech}', [SpeechController::class, 'show'])->name('api.speeches.show');

    Route::post('/speeches/{speech}/assets/uploads', [SpeechUploadController::class, 'createUpload'])
        ->name('api.speeches.assets.uploads.create');
    Route::post('/speeches/{speech}/assets/{asset}/uploads/{uploadId}/parts/{partNumber}', [SpeechUploadController::class, 'signPart'])
        ->name('api.speeches.assets.uploads.sign-part');
    Route::post('/speeches/{speech}/assets/{asset}/uploads/{uploadId}/complete', [SpeechUploadController::class, 'complete'])
        ->name('api.speeches.assets.uploads.complete');
    Route::delete('/speeches/{speech}/assets/{asset}/uploads/{uploadId}', [SpeechUploadController::class, 'abort'])
        ->name('api.speeches.assets.uploads.abort');
    Route::post('/speeches/{speech}/assets/{asset}/retry', [SpeechUploadController::class, 'retry'])
        ->name('api.speeches.assets.retry');
    Route::get('/speeches/{speech}/assets/{asset}/playback-url', [SpeechUploadController::class, 'playbackUrl'])
        ->name('api.speeches.assets.playback-url');

    // STEP-04-every-video-plays.md §9.5: posters/sprites (delivered via
    // SpeechResource) plus the two supporting endpoints — frame picking and
    // the transcode-queue backpressure gauge.
    Route::post('/speeches/{speech}/assets/{asset}/poster-frame', [SpeechUploadController::class, 'setPosterFrame'])
        ->name('api.speeches.assets.poster-frame');

    // Global (not speech/asset-scoped, matching §9.5's literal wording) —
    // the UI's "processing is backed up" banner reads this directly.
    Route::get('/queue/transcode-depth', QueueStatusController::class)
        ->name('api.queue.transcode-depth');

    // STEP-05-invitation-loop.md (§6.3, §6.11, §7.3, §7.5): the invitation
    // loop. Deliberately NO route anywhere lists "reviewable speeches" or
    // an open pool (§7.1) — /reviewers (the directory, below) is the only
    // discovery mechanism.
    Route::post('/speeches/{speech}/reviews', [ReviewController::class, 'invite'])
        ->name('api.speeches.reviews.invite');
    Route::get('/speeches/{speech}/reviews', [ReviewController::class, 'forSpeech'])
        ->name('api.speeches.reviews.index');

    // STEP-06-watch-commentary.md: read-only. `review_id` is a required
    // query param (FormRequest-validated), not a route segment — matches
    // the frozen backend/frontend contract exactly.
    Route::get('/speeches/{speech}/annotations', [AnnotationController::class, 'index'])
        ->name('api.speeches.annotations.index');

    // STEP-07-write-commentary.md: the authoring surface. None of these
    // accept a client-supplied review_id anywhere (route, query or body) —
    // the caller's own review is always resolved server-side from
    // (speech, $request->user()), so no reviewer can construct a URL
    // targeting a peer's review.
    Route::post('/speeches/{speech}/annotations', [AnnotationController::class, 'store'])
        ->name('api.speeches.annotations.store');
    Route::post('/speeches/{speech}/voice-notes', [VoiceAnnotationController::class, 'store'])
        ->middleware('verified.api')
        ->name('api.speeches.voice-notes.store');
    Route::get('/speeches/{speech}/annotations/{annotation}/voice-playback-url', [VoiceAnnotationController::class, 'audioUrl'])
        ->middleware('verified.api')
        ->name('api.speeches.annotations.voice-playback-url');
    Route::post('/speeches/{speech}/annotations/{annotation}/voice-transcript/retry', [VoiceAnnotationController::class, 'retryTranscript'])
        ->middleware('verified.api')
        ->name('api.speeches.annotations.voice-transcript.retry');
    Route::post('/speeches/{speech}/annotations/{annotation}/restore', [VoiceAnnotationController::class, 'restore'])
        ->middleware('verified.api')
        ->name('api.speeches.annotations.restore');
    Route::patch('/speeches/{speech}/annotations/{annotation}', [AnnotationController::class, 'update'])
        ->name('api.speeches.annotations.update');
    Route::delete('/speeches/{speech}/annotations/{annotation}', [AnnotationController::class, 'destroy'])
        ->name('api.speeches.annotations.destroy');
    Route::delete('/speeches/{speech}/annotation-sets/me', [AnnotationController::class, 'clearMine'])
        ->name('api.speeches.annotation-sets.clear-mine');

    // STEP-08-essay.md: the essay surface. Same "reads take an explicit
    // review_id, writes derive the caller's own review server-side" split
    // as the annotation routes above, for the same reason.
    Route::get('/speeches/{speech}/essay', [EssayController::class, 'show'])
        ->name('api.speeches.essay.show');
    Route::put('/speeches/{speech}/essay', [EssayController::class, 'update'])
        ->name('api.speeches.essay.update');
    Route::post('/speeches/{speech}/essay/publish', [EssayController::class, 'publish'])
        ->name('api.speeches.essay.publish');

    // STEP-09-captions.md / the frozen STEP-09 backend contract §4: no
    // optimistic-locking/409 on captions (unlike essay/annotation writes
    // above) — the contract is explicit that single-speaker VTT editing
    // has no concurrent-writer scenario to guard against.
    Route::get('/speeches/{speech}/captions', [CaptionController::class, 'show'])
        ->name('api.speeches.captions.show');
    Route::put('/speeches/{speech}/captions', [CaptionController::class, 'update'])
        ->name('api.speeches.captions.update');

    // captions-settings gap fix (post-STEP-09 code review): the missing
    // write surface for `speeches.captions_enabled` — STEP-09 shipped the
    // column and every defensive read of it, but no route to flip it.
    // Owner-only (`caption.update`, the same gate `PUT /captions` uses),
    // registered alongside the other caption routes above.
    Route::patch('/speeches/{speech}/caption-settings', [CaptionController::class, 'updateSettings'])
        ->name('api.speeches.caption-settings.update');

    Route::get('/speeches/{speech}/transcript', [TranscriptController::class, 'show'])
        ->name('api.speeches.transcript.show');

    Route::post('/reviews/{review}/accept', [ReviewController::class, 'accept'])
        ->name('api.reviews.accept');
    Route::post('/reviews/{review}/decline', [ReviewController::class, 'decline'])
        ->name('api.reviews.decline');
    Route::post('/reviews/{review}/withdraw', [ReviewController::class, 'withdraw'])
        ->name('api.reviews.withdraw');
    Route::post('/reviews/{review}/revoke', [ReviewController::class, 'revoke'])
        ->name('api.reviews.revoke');
    Route::post('/reviews/{review}/revoke-and-purge', [ReviewController::class, 'revokeAndPurge'])
        ->name('api.reviews.revoke-and-purge');
    Route::post('/reviews/{review}/abandon', [ReviewController::class, 'abandon'])
        ->name('api.reviews.abandon');
    Route::post('/reviews/{review}/publish', [ReviewController::class, 'publish'])
        ->name('api.reviews.publish');
    Route::get('/reviews', [ReviewController::class, 'index'])
        ->name('api.reviews.index');

    // §6.3/§7.1: the reviewer directory — browsable/filterable/searchable,
    // the only mechanism for finding someone to invite.
    Route::get('/reviewers', [ReviewerDirectoryController::class, 'index'])
        ->name('api.reviewers.index');

    // §7.5's in-app notification bell — read/mark-read over Laravel's stock
    // DatabaseNotification rows written by ReviewService's queued notices.
    Route::get('/notifications', [NotificationController::class, 'index'])
        ->name('api.notifications.index');
    Route::post('/notifications/{notification}/read', [NotificationController::class, 'markRead'])
        ->name('api.notifications.read');

    // STEP-11-FROZEN-CONTRACT.md §1: reports land in a table; the admin
    // queue UI arrives in STEP-12 (`php artisan reports:list` prints them
    // until then). Authorization is inline in the controller
    // (`Gate::allows('view', $reportable)`, reusing SpeechPolicy::view —
    // no new Gate ability, per §1).
    Route::post('/reports', [ReportController::class, 'store'])
        ->name('api.reports.store');

    // STEP-11-FROZEN-CONTRACT.md §7: async export, signed-URL delivery.
    // Self-scoped throughout — always $request->user(), no Policy needed
    // (§8).
    Route::post('/privacy/exports', [PrivacyExportController::class, 'store'])
        ->name('api.privacy.exports.store');
    Route::get('/privacy/exports', [PrivacyExportController::class, 'index'])
        ->name('api.privacy.exports.index');
    Route::get('/privacy/exports/{export}/download', [PrivacyExportController::class, 'download'])
        ->name('api.privacy.exports.download');

    // STEP-11-FROZEN-CONTRACT.md §8: self-scoped account erasure — always
    // $request->user(), no admin path this step (that's STEP-12's
    // `user.erase`, deliberately left reserved-but-undefined in
    // AppServiceProvider's $mustFallThrough).
    Route::delete('/account', [AccountController::class, 'destroy'])
        ->middleware('verified.api')
        ->name('api.account.destroy');

    // STEP-12-FROZEN-CONTRACT.md §9: the applicant's side of the coach-
    // application loop. Self-scoped throughout, no Policy needed — same
    // shape as the privacy/export routes above.
    Route::post('/coach-applications', [CoachApplicationController::class, 'store'])
        ->name('api.coach-applications.store');
    Route::get('/coach-applications/me', [CoachApplicationController::class, 'me'])
        ->name('api.coach-applications.me');
    Route::post('/coach-applications/{coachApplication}/documents', [CoachApplicationController::class, 'uploadDocuments'])
        ->name('api.coach-applications.documents.store');

    // STEP-13-FROZEN-CONTRACT.md §5/§9: the social layer. `POST /connections`
    // is idempotent-upsert shaped (new request / re-request after decline /
    // crossed-request resolves to accepted, all the same call — see
    // ConnectionService::request's own docblock), rate-limited per (requester,
    // target) pair (R17, §8). `{connection}` ids are always resolved to the
    // caller's OWN mirrored row inside the controller before any service
    // call.
    Route::post('/connections', [ConnectionController::class, 'store'])
        ->middleware('throttle:connection-request')
        ->name('api.connections.store');
    Route::post('/connections/{connection}/accept', [ConnectionController::class, 'accept'])
        ->name('api.connections.accept');
    Route::post('/connections/{connection}/decline', [ConnectionController::class, 'decline'])
        ->name('api.connections.decline');
    Route::post('/connections/{connection}/block', [ConnectionController::class, 'block'])
        ->name('api.connections.block');
    Route::post('/connections/{connection}/unblock', [ConnectionController::class, 'unblock'])
        ->name('api.connections.unblock');
    Route::get('/connections', [ConnectionController::class, 'index'])
        ->name('api.connections.index');

    // §6.7.3: the profile timeline, driven entirely off `reviews` — see
    // ProfileTimelineController's own docblock for why `connections` never
    // appears in this query. Auth-required (unlike `GET /u/{username}`
    // below, which is public identity-only): the timeline is inherently
    // viewer-scoped, "U's speeches on which V holds a grant".
    Route::get('/u/{username}/timeline', [ProfileTimelineController::class, 'show'])
        ->name('api.profiles.timeline');
});

// Public identity view — no auth (§7.1: viewing another user's public profile
// is permitted to everyone, including anonymous visitors).
Route::get('/u/{username}', [ProfileController::class, 'show'])->name('api.profiles.show');
