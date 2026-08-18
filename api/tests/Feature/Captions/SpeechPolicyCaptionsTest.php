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

it('readCaptions grants an in_progress reviewer', function () {
    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    Review::factory()->create([
        'speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id,
        'status' => 'in_progress',
    ]);

    expect((new SpeechPolicy)->readCaptions($reviewer, $speech))->toBeTrue();
});

it('readCaptions grants a published reviewer', function () {
    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    Review::factory()->published()->create(['speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id]);

    expect((new SpeechPolicy)->readCaptions($reviewer, $speech))->toBeTrue();
});

/**
 * Security-review finding: readCaptions used to delegate to `view()`,
 * which admits a merely-`invited` (not yet accepted) reviewer. The
 * method's own contract requires ACCESS_GRANTING — this must be DENIED.
 */
it('readCaptions denies a merely invited (not yet accepted) reviewer', function () {
    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    Review::factory()->create([
        'speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id,
        'status' => 'invited',
    ]);

    expect((new SpeechPolicy)->readCaptions($reviewer, $speech))->toBeFalse();
});

it('readCaptions denies a revoked reviewer even with an access-granting status', function () {
    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    Review::factory()->accepted()->revoked()->create(['speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id]);

    expect((new SpeechPolicy)->readCaptions($reviewer, $speech))->toBeFalse();
});

it('readCaptions denies a declined reviewer', function () {
    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    Review::factory()->declined()->create(['speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id]);

    expect((new SpeechPolicy)->readCaptions($reviewer, $speech))->toBeFalse();
});

it('readCaptions denies an abandoned reviewer', function () {
    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    Review::factory()->create([
        'speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id,
        'status' => 'abandoned',
    ]);

    expect((new SpeechPolicy)->readCaptions($reviewer, $speech))->toBeFalse();
});

it('readCaptions denies a stranger', function () {
    $owner = User::factory()->create();
    $stranger = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();

    expect((new SpeechPolicy)->readCaptions($stranger, $speech))->toBeFalse();
});

it('readCaptions denies an unrelated admin via a direct policy call (no Gate::before shortcut)', function () {
    $this->seed(RoleSeeder::class);
    $owner = User::factory()->create();
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $speech = Speech::factory()->for($owner)->create();

    expect((new SpeechPolicy)->readCaptions($admin, $speech))->toBeFalse();
});

it('caption.readCaptions falls through Gate::before for an admin via the HTTP-level Gate check', function () {
    $this->seed(RoleSeeder::class);
    $owner = User::factory()->create();
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $speech = Speech::factory()->for($owner)->create();

    expect($admin->can('caption.readCaptions', $speech))->toBeTrue();
    expect($owner->can('caption.readCaptions', $speech))->toBeTrue();
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
