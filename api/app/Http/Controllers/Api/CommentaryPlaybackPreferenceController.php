<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Speech;
use App\Services\UserPreferenceWriter;
use App\Support\CommentaryPlaybackPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class CommentaryPlaybackPreferenceController extends Controller
{
    public function __construct(private readonly UserPreferenceWriter $preferences) {}

    public function show(Request $request, Speech $speech): JsonResponse
    {
        $this->authorize('view', $speech);

        return new JsonResponse(['commentary_playback' => CommentaryPlaybackPreference::resolve(
            $this->currentUser($request)->refresh()->preferences,
            $speech->id,
        )]);
    }

    public function update(Request $request, Speech $speech): JsonResponse
    {
        $this->authorize('view', $speech);
        $data = $request->validate(['mode' => ['required', 'string', Rule::in(CommentaryPlaybackPreference::MODES)]]);
        $currentUser = $this->currentUser($request);

        $user = $this->preferences->updatePlayback($currentUser, $speech->id, $data);
        $preference = CommentaryPlaybackPreference::resolve($user->preferences, $speech->id);

        return new JsonResponse(['commentary_playback' => $preference]);
    }
}
