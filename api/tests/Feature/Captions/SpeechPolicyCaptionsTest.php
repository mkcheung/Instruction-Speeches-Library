<?php

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Policies\SpeechPolicy;
use Database\Seeders\RoleSeeder;

/**
 * The frozen STEP-09 backend contract §1: new SpeechPolicy methods, not
 * AnnotationPolicy::readAnnotations — captions/transcripts belong to the
 * Speech and can exist with zero reviews.
 */
it('readCaptions grants the owner', function () {
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();

    expect((new SpeechPolicy)->readCaptions($owner, $speech))->toBeTrue();
});

it('readCaptions grants an accepted (access-granting) reviewer', function () {
    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    Review::factory()->accepted()->create(['speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id]);

    expect((new SpeechPolicy)->readCaptions($reviewer, $speech))->toBeTrue();
});

it('readCaptions denies a stranger', function () {
    $owner = User::factory()->create();
    $stranger = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();

    expect((new SpeechPolicy)->readCaptions($stranger, $speech))->toBeFalse();
});

it('updateCaptions grants only the owner, never a reviewer', function () {
    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    Review::factory()->accepted()->create(['speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id]);

    expect((new SpeechPolicy)->updateCaptions($owner, $speech))->toBeTrue();
    expect((new SpeechPolicy)->updateCaptions($reviewer, $speech))->toBeFalse();
});

it('caption.update falls through Gate::before for an admin (ownership-only, no admin override)', function () {
    $this->seed(RoleSeeder::class);
    $owner = User::factory()->create();
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $speech = Speech::factory()->for($owner)->create();

    expect($admin->can('caption.update', $speech))->toBeFalse();
    expect($owner->can('caption.update', $speech))->toBeTrue();
});
