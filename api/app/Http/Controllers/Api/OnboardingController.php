<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Onboarding\StepOneRequest;
use App\Http\Requests\Onboarding\StepThreeRequest;
use App\Http\Requests\Onboarding\StepTwoRequest;
use App\Http\Resources\UserResource;
use App\Models\Profile;
use App\Services\AvatarProcessor;
use App\Services\UsernameService;
use App\Support\Onboarding;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Resumable onboarding (§6.5): each step writes straight to `users`/
 * `profiles` rather than accumulating client-side state, so a user who
 * quits after step 2 and returns tomorrow resumes at step 2 — there is
 * nothing to "resume," the row already reflects reality.
 */
class OnboardingController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $user = $request->user()->load('profile');

        return new JsonResponse([
            'step' => Onboarding::currentStep($user),
            'user' => new UserResource($user),
        ]);
    }

    public function stepOne(StepOneRequest $request, UsernameService $usernames): JsonResponse
    {
        $user = $request->user();

        $usernames->set($user, $request->validated('username'));

        $user->fill([
            'first_name' => $request->validated('first_name'),
            'last_name' => $request->validated('last_name'),
        ])->save();

        return new JsonResponse([
            'step' => Onboarding::currentStep($user->fresh('profile')),
            'user' => new UserResource($user->fresh('profile')),
        ]);
    }

    public function stepTwo(StepTwoRequest $request): JsonResponse
    {
        $user = $request->user();

        /** @var Profile $profile */
        $profile = Profile::query()->firstOrCreate(['user_id' => $user->id]);
        $profile->fill($request->only(['bio', 'pronouns', 'location']))->save();

        return new JsonResponse([
            'step' => Onboarding::currentStep($user->fresh('profile')),
            'user' => new UserResource($user->fresh('profile')),
        ]);
    }

    public function stepThree(StepThreeRequest $request, AvatarProcessor $avatars): JsonResponse
    {
        $user = $request->user();

        /** @var Profile $profile */
        $profile = Profile::query()->firstOrCreate(['user_id' => $user->id]);

        if ($request->hasFile('avatar')) {
            $profile->avatar_path = $avatars->process($request->file('avatar'), $user->id);
        }

        // The last step's submission is what completes onboarding, whether
        // or not an avatar was actually attached (bio/avatar are
        // skippable — §6.5).
        $profile->onboarding_completed_at ??= now();
        $profile->save();

        return new JsonResponse([
            'step' => Onboarding::currentStep($user->fresh('profile')),
            'user' => new UserResource($user->fresh('profile')),
        ]);
    }
}
