<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Speech;
use App\Services\UserPreferenceWriter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class VoicePreferenceController extends Controller
{
    public function __construct(private readonly UserPreferenceWriter $preferences) {}

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
        $user = $this->preferences->updateVoice($currentUser, $speech->id, $data);
        $entry = $user->preferences['voice_commentary'][(string) $speech->id];

        return new JsonResponse(['voice_commentary' => ['speech_id' => $speech->id, ...$entry]]);
    }
}
