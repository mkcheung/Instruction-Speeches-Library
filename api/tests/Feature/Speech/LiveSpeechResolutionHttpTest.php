<?php

use App\Models\Speech;
use App\Models\User;

it('preserves missing versus deleted speech status for each shared lookup family', function (string $endpoint) {
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    $speech->delete();
    $this->actingAs($owner);

    $this->getJson('/api/speeches/'.$speech->id.'/'.$endpoint)->assertGone();
    $this->getJson('/api/speeches/'.($speech->id + 1000).'/'.$endpoint)->assertNotFound();
})->with(['annotations?review_id=1', 'essay?review_id=1', 'captions', 'transcript']);
