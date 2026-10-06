<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Speech;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class VoicePreferenceController extends Controller
{
    public function show(Request $request, Speech $speech): JsonResponse
    {
        $this->authorize('view', $speech);
        $entry = ($this->currentUser($request)->preferences ?? [])['voice_commentary'][(string) $speech->id]
            ?? ['mode' => 'play', 'experienced' => false];

        return new JsonResponse(['voice_commentary' => ['speech_id' => $speech->id, ...$entry]]);
    }

    public function update(Request $request, Speech $speech): JsonResponse
    {
        $this->authorize('view', $speech);
        $data = $request->validate([
            'mode' => ['required', Rule::in(['play', 'text', 'none'])],
            'experienced' => ['required', 'boolean'],
        ]);

        $currentUser = $this->currentUser($request);
        $user = DB::transaction(function () use ($currentUser, $speech, $data) {
            $user = $currentUser->newQuery()->whereKey($currentUser->id)->lockForUpdate()->firstOrFail();
            $preferences = $user->preferences ?? [];
            $preferences['voice_commentary'][(string) $speech->id] = $data;
            $user->update(['preferences' => $preferences]);

            return $user;
        });
        $entry = $user->preferences['voice_commentary'][(string) $speech->id];

        return new JsonResponse(['voice_commentary' => ['speech_id' => $speech->id, ...$entry]]);
    }
}
