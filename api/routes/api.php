<?php

use App\Http\Controllers\Api\AvatarController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\OnboardingController;
use App\Http\Controllers\Api\PresignController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\SpeechController;
use App\Http\Controllers\Api\SpeechUploadController;
use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class)->name('api.health');

// Spike-wall only (S0): no auth yet, per STEP-00-foundation.md.
Route::get('/spikes/presign', PresignController::class)->name('api.spikes.presign');

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

    Route::get('/onboarding', [OnboardingController::class, 'show'])->name('api.onboarding.show');
    Route::post('/onboarding/step-1', [OnboardingController::class, 'stepOne'])->name('api.onboarding.step1');
    Route::post('/onboarding/step-2', [OnboardingController::class, 'stepTwo'])->name('api.onboarding.step2');
    Route::post('/onboarding/step-3', [OnboardingController::class, 'stepThree'])->name('api.onboarding.step3');

    Route::patch('/profile', [ProfileController::class, 'updateSelf'])->name('api.profile.update');
    Route::patch('/profile/username', [ProfileController::class, 'updateUsername'])->name('api.profile.username');
    Route::post('/avatar', [AvatarController::class, 'update'])->name('api.avatar.update');

    // STEP-03-upload-and-watch.md (§9, §6.11): upload and watch. Ownership
    // is checked inline in each controller method, not via a Policy — no
    // Policy classes exist in this codebase yet (matches S1/S2's pattern).
    Route::get('/speeches', [SpeechController::class, 'index'])->name('api.speeches.index');
    Route::post('/speeches', [SpeechController::class, 'store'])->name('api.speeches.store');
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
});

// Public identity view — no auth (§7.1: viewing another user's public profile
// is permitted to everyone, including anonymous visitors).
Route::get('/u/{username}', [ProfileController::class, 'show'])->name('api.profiles.show');
