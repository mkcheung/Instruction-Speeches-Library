<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Speech;
use App\Support\CommentaryPlaybackPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class CommentaryPlaybackPreferenceController extends Controller
{
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

        $preference = DB::transaction(function () use ($currentUser, $speech, $data) {
            // Re-read under the same row lock used by the legacy writer. Its
            // separately merged namespace must survive concurrent old tabs.
            $user = $currentUser->newQuery()->whereKey($currentUser->id)->lockForUpdate()->firstOrFail();
            $preferences = $user->preferences ?? [];
            $entries = $preferences['commentary_playback'] ?? [];
            $preferences['commentary_playback'] = is_array($entries) ? $entries : [];
            $preferences['commentary_playback'][(string) $speech->id] = ['mode' => $data['mode']];
            $user->update(['preferences' => $preferences]);

            return CommentaryPlaybackPreference::resolve($preferences, $speech->id);
        });

        return new JsonResponse(['commentary_playback' => $preference]);
    }
}
