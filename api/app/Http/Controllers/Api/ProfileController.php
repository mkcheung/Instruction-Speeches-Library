<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateProfileRequest;
use App\Http\Requests\UpdateUsernameRequest;
use App\Http\Resources\PublicProfileResource;
use App\Http\Resources\UserResource;
use App\Models\Profile;
use App\Models\User;
use App\Models\UsernameHistory;
use App\Services\UsernameService;
use App\Support\Username;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

class ProfileController extends Controller
{
    /**
     * GET /u/{username} — public identity only (S1's deliberate stub: no
     * timeline, no connections rail). A miss on `users` is checked against
     * `username_history` before answering 404, purely to tell the
     * front end "this handle moved/was released" rather than "never
     * existed" — the route itself never redirects to the new owner, since
     * §6.5 explicitly forbids a released handle being traceable to its new
     * holder via the old one.
     */
    public function show(string $username): JsonResponse
    {
        $normalized = Username::normalize($username);

        $user = User::query()->with('profile')->where('username', $normalized)->first();

        if ($user === null) {
            $everHeldBySomeone = UsernameHistory::query()->where('username', $normalized)->exists();

            return new JsonResponse([
                'message' => $everHeldBySomeone
                    ? 'This username is no longer in use.'
                    : 'No such user.',
            ], Response::HTTP_NOT_FOUND);
        }

        return new JsonResponse(['profile' => new PublicProfileResource($user)]);
    }

    public function updateSelf(UpdateProfileRequest $request): JsonResponse
    {
        $user = $request->user();

        /** @var Profile $profile */
        $profile = Profile::query()->firstOrCreate(['user_id' => $user->id]);
        $profile->fill($request->validated())->save();

        return new JsonResponse(['user' => new UserResource($user->fresh('profile'))]);
    }

    public function updateUsername(UpdateUsernameRequest $request, UsernameService $usernames): JsonResponse
    {
        $user = $usernames->set($request->user(), $request->validated('username'));

        return new JsonResponse(['user' => new UserResource($user->fresh('profile'))]);
    }
}
