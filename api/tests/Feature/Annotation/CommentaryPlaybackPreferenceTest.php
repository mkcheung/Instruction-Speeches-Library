<?php

use App\Models\Speech;
use App\Models\User;

function playbackPreferenceUrl(Speech $speech): string
{
    return "/api/me/preferences/commentary-playback/{$speech->id}";
}

it('returns the default without writing a preference', function () {
    $user = User::factory()->create(['preferences' => ['unrelated' => true]]);
    $speech = Speech::factory()->for($user)->create();

    $this->actingAs($user)->getJson(playbackPreferenceUrl($speech))->assertOk()
        ->assertExactJson(['commentary_playback' => ['speech_id' => $speech->id, 'mode' => 'all', 'source' => 'default']]);
    expect($user->fresh()->preferences)->toBe(['unrelated' => true]);
});

it('derives a legacy preference without writing or enabling unexpected audio', function (string $legacy, string $mode) {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $preferences = ['voice_commentary' => [$speech->id => ['mode' => $legacy, 'experienced' => true]]];
    $user->update(['preferences' => $preferences]);

    $this->actingAs($user)->getJson(playbackPreferenceUrl($speech))->assertOk()
        ->assertExactJson(['commentary_playback' => [
            'speech_id' => $speech->id, 'mode' => $mode, 'source' => 'legacy', 'legacy_mode' => $legacy,
        ]]);
    expect($user->fresh()->preferences)->toBe($preferences);
})->with(['play' => ['play', 'all'], 'none' => ['none', 'written'], 'text' => ['text', 'written']]);

it('saves canonical modes while preserving legacy and unrelated settings', function (string $mode) {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $user->update(['preferences' => ['unrelated' => ['kept' => true], 'voice_commentary' => [
        $speech->id => ['mode' => 'text', 'experienced' => true],
    ]]]);

    $this->actingAs($user)->patchJson(playbackPreferenceUrl($speech), ['mode' => $mode])->assertOk()
        ->assertExactJson(['commentary_playback' => ['speech_id' => $speech->id, 'mode' => $mode, 'source' => 'saved']]);
    expect($user->fresh()->preferences)->toMatchArray([
        'unrelated' => ['kept' => true],
        'voice_commentary' => [$speech->id => ['mode' => 'text', 'experienced' => true]],
        'commentary_playback' => [$speech->id => ['mode' => $mode]],
    ]);
})->with(['all', 'written', 'voice', 'off']);

it('keeps canonical settings authoritative after an old browser updates legacy settings', function () {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $this->actingAs($user)->patchJson(playbackPreferenceUrl($speech), ['mode' => 'off'])->assertOk();
    $this->patchJson("/api/me/preferences/voice-commentary/{$speech->id}", ['mode' => 'play', 'experienced' => true])
        ->assertOk()->assertJsonPath('voice_commentary.mode', 'play');
    $this->getJson(playbackPreferenceUrl($speech))->assertOk()->assertJsonPath('commentary_playback.mode', 'off');
});

it('fails closed for malformed saved or legacy entries', function (array $settings) {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $preferences = [];
    foreach ($settings as $namespace => $entry) {
        $preferences[$namespace] = [$speech->id => $entry];
    }
    $user->update(['preferences' => $preferences]);
    $this->actingAs($user)->getJson(playbackPreferenceUrl($speech))->assertOk()
        ->assertExactJson(['commentary_playback' => ['speech_id' => $speech->id, 'mode' => 'off', 'source' => 'invalid']]);
    expect($user->fresh()->preferences)->toBe($preferences);
})->with([
    [['commentary_playback' => ['mode' => 'unknown'], 'voice_commentary' => ['mode' => 'play']]],
    [['commentary_playback' => null, 'voice_commentary' => ['mode' => 'play']]],
    [['voice_commentary' => ['mode' => 'unknown']]],
    [['voice_commentary' => 'invalid']],
]);

it('rejects noncanonical modes', function (mixed $mode) {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $this->actingAs($user)->patchJson(playbackPreferenceUrl($speech), ['mode' => $mode])
        ->assertUnprocessable()->assertJsonValidationErrors('mode');
    expect($user->fresh()->preferences['commentary_playback'] ?? null)->toBeNull();
})->with(['play', 'text', 'none', 'unknown', null, [['array']]]);

it('fails closed for a malformed present namespace without reviving legacy audio', function (string $namespace) {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $preferences = ['voice_commentary' => [$speech->id => ['mode' => 'play']]];
    $preferences[$namespace] = 'malformed namespace';
    $user->update(['preferences' => $preferences]);
    $this->actingAs($user)->getJson(playbackPreferenceUrl($speech))->assertOk()
        ->assertJsonPath('commentary_playback.mode', 'off')->assertJsonPath('commentary_playback.source', 'invalid');
    expect($user->fresh()->preferences)->toBe($preferences);
})->with(['commentary_playback', 'voice_commentary']);

it('isolates users and speeches and enforces view access', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    $second = Speech::factory()->for($owner)->create();
    $this->actingAs($owner)->patchJson(playbackPreferenceUrl($speech), ['mode' => 'off'])->assertOk();
    $this->getJson(playbackPreferenceUrl($second))->assertOk()->assertJsonPath('commentary_playback.mode', 'all');
    $this->actingAs($other)->getJson(playbackPreferenceUrl($speech))->assertForbidden();
    $this->patchJson(playbackPreferenceUrl($speech), ['mode' => 'all'])->assertForbidden();
    expect($other->fresh()->preferences['commentary_playback'] ?? null)->toBeNull();
    expect($owner->fresh()->preferences['commentary_playback'][$speech->id]['mode'])->toBe('off');
});

it('requires authentication and a verified account', function () {
    $user = User::factory()->unverified()->create();
    $speech = Speech::factory()->for($user)->create();
    $this->getJson(playbackPreferenceUrl($speech))->assertUnauthorized();
    $this->patchJson(playbackPreferenceUrl($speech), ['mode' => 'off'])->assertUnauthorized();
    $this->actingAs($user)->getJson(playbackPreferenceUrl($speech))->assertForbidden();
    $this->patchJson(playbackPreferenceUrl($speech), ['mode' => 'off'])->assertForbidden();
});
