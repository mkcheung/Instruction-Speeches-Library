<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateAvatarRequest;
use App\Http\Resources\UserResource;
use App\Models\Profile;
use App\Services\AvatarProcessor;
use Illuminate\Http\JsonResponse;

/**
 * Standalone avatar (re-)upload for an already-onboarded profile. Shares
 * App\Services\AvatarProcessor with the onboarding step-3 endpoint so the
 * EXIF re-encoding guarantee lives in exactly one place.
 */
class AvatarController extends Controller
{
    public function update(UpdateAvatarRequest $request, AvatarProcessor $avatars): JsonResponse
    {
        $user = $request->user();

        /** @var Profile $profile */
        $profile = Profile::query()->firstOrCreate(['user_id' => $user->id]);
        $profile->avatar_path = $avatars->process($request->file('avatar'), $user->id);
        $profile->save();

        return new JsonResponse([
            'user' => new UserResource($user->fresh('profile')),
        ]);
    }
}
