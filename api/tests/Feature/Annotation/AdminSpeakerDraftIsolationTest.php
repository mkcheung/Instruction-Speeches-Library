<?php

use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use Database\Seeders\RoleSeeder;

/**
 * §8.5: "the speaker must never see a coach's drafts" — a property of
 * standing in the speaker's shoes, NOT of lacking a role.
 *
 * Code-review finding: Annotation::scopeVisibleTo returned every row for
 * any admin, and AnnotationPolicy::readAnnotations' unconditional admin
 * branch ran BEFORE the speaker branch. So an admin who owned the speech
 * read their own coach's unpublished drafts and unpublished essay verbatim,
 * while an identical member-owned speech correctly returned nothing.
 * Admin moderation of ANOTHER user's speech is a separate, intentional
 * power and is asserted here to still work.
 */
function adminSpeakerFixture(string $ownerRole): array
{
    $owner = User::factory()->create();
    $owner->assignRole($ownerRole);
    $coach = User::factory()->create();
    $coach->assignRole('coach');

    $speech = Speech::factory()->for($owner)->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'speech_owner_id' => $owner->id,
        'reviewer_id' => $coach->id,
        'status' => 'in_progress',
        'essay_html' => '<p>UNPUBLISHED ESSAY</p>',
        'essay_text' => 'UNPUBLISHED ESSAY',
        'essay_published_at' => null,
    ]);
    Annotation::factory()->for($review)->draft()->create(['body' => 'SECRET DRAFT']);

    return [$owner, $speech, $review];
}

it('does not leak a coach\'s unpublished drafts to the speaker, whatever role the speaker holds', function (string $ownerRole) {
    $this->seed(RoleSeeder::class);
    [$owner, $speech, $review] = adminSpeakerFixture($ownerRole);

    $response = $this->actingAs($owner)->withHeader('Accept', 'application/json')
        ->getJson("/api/speeches/{$speech->id}/annotations?review_id={$review->id}");

    $response->assertOk();
    expect($response->json('annotations'))->toBe([]);
})->with(['member', 'admin']);

it('does not leak a coach\'s unpublished essay to the speaker, whatever role the speaker holds', function (string $ownerRole) {
    $this->seed(RoleSeeder::class);
    [$owner, $speech, $review] = adminSpeakerFixture($ownerRole);

    $response = $this->actingAs($owner)->withHeader('Accept', 'application/json')
        ->getJson("/api/speeches/{$speech->id}/essay?review_id={$review->id}");

    $response->assertOk();
    // EssayResource serializes the masked null body as an empty string.
    expect($response->json('essay.essay_html'))->toBe('');
})->with(['member', 'admin']);

it('still lets an admin moderate another user\'s speech, drafts included', function () {
    $this->seed(RoleSeeder::class);
    [, $speech, $review] = adminSpeakerFixture('member');

    $admin = User::factory()->create();
    $admin->assignRole('admin');

    $annotations = $this->actingAs($admin)->withHeader('Accept', 'application/json')
        ->getJson("/api/speeches/{$speech->id}/annotations?review_id={$review->id}");
    $annotations->assertOk();
    expect($annotations->json('annotations.0.body'))->toBe('SECRET DRAFT');

    $essay = $this->actingAs($admin)->withHeader('Accept', 'application/json')
        ->getJson("/api/speeches/{$speech->id}/essay?review_id={$review->id}");
    $essay->assertOk();
    expect($essay->json('essay.essay_html'))->toBe('<p>UNPUBLISHED ESSAY</p>');
});
