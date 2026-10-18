<?php

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Notifications\ReviewInvited;

/**
 * §7.6C.2: `ReviewInvited::toMail()` used to interpolate the speaker's
 * free-text `invitation_message` straight into the mail body. Laravel's
 * Markdown mail layer escapes raw HTML and blocks `javascript:`/`data:`
 * link schemes, but it does NOT escape CommonMark's own `[text](url)`
 * link syntax — so a speaker writing `[click here](https://evil.example)`
 * as their invitation message rendered as a live, clickable link in
 * outgoing mail. The fix stops the free text from reaching the mail body
 * at all; these tests render the actual mail HTML via `MailMessage::render()`
 * itself (the same method `MailChannel::buildMarkdownHtml()` ultimately
 * calls through — see that class's `markdownRenderer()`) rather than
 * re-deriving the theme/markdown-view lookup here, and prove the
 * malicious markdown source is gone and no corresponding `<a>` tag is
 * produced, while the safe fixed copy still appears.
 */
function renderReviewInvitedMailHtml(Review $review): string
{
    $message = (new ReviewInvited($review))->toMail($review->reviewer);

    return (string) $message->render();
}

it('does not render a malicious invitation_message as a clickable link', function () {
    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();

    $review = Review::factory()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'invited_by_id' => $speaker->id,
        'invitation_message' => '[click here](https://evil.example)',
        'status' => 'invited',
    ]);

    $html = renderReviewInvitedMailHtml($review->fresh());

    // The CommonMark link syntax must not survive into the rendered mail...
    expect($html)->not->toContain('[click here]');
    expect($html)->not->toContain('https://evil.example');
    // ...and it must not have been turned into a live link either.
    expect($html)->not->toContain('<a href="https://evil.example"');

    // The safe, fixed copy takes its place.
    expect($html)->toContain('They left you a personal note');
});

it('mentions a note exists when invitation_message is set, with the safe fixed copy', function () {
    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();

    $review = Review::factory()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'invited_by_id' => $speaker->id,
        'invitation_message' => 'Please take a look before Friday.',
        'status' => 'invited',
    ]);

    $html = renderReviewInvitedMailHtml($review->fresh());

    expect($html)->toContain('They left you a personal note — open your dashboard to read it.');
    expect($html)->not->toContain('Please take a look before Friday.');
});

it('does not render a malicious speech title as a clickable link', function () {
    $speaker = User::factory()->create(['first_name' => 'Jane', 'last_name' => 'Doe']);
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create(['title' => '[click here](https://evil.example)']);

    $review = Review::factory()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'invited_by_id' => $speaker->id,
        'invitation_message' => null,
        'status' => 'invited',
    ]);

    $html = renderReviewInvitedMailHtml($review->fresh());

    // The escaped markdown syntax still shows the title's literal text
    // (unlike invitation_message, which is suppressed outright) — the
    // bug this guards against is specifically a live, clickable link,
    // not the URL text appearing at all.
    expect($html)->not->toContain('<a href="https://evil.example"')
        ->and($html)->toContain('[click here]');
});

it('does not render a malicious inviter name as a clickable link', function () {
    $speaker = User::factory()->create([
        'first_name' => '[click here](https://evil.example)',
        'last_name' => 'Doe',
    ]);
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();

    $review = Review::factory()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'invited_by_id' => $speaker->id,
        'invitation_message' => null,
        'status' => 'invited',
    ]);

    $html = renderReviewInvitedMailHtml($review->fresh());

    expect($html)->not->toContain('<a href="https://evil.example"')
        ->and($html)->toContain('[click here]');
});

it('says nothing about a note when invitation_message is null', function () {
    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();

    $review = Review::factory()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'invited_by_id' => $speaker->id,
        'invitation_message' => null,
        'status' => 'invited',
    ]);

    $html = renderReviewInvitedMailHtml($review->fresh());

    expect($html)->not->toContain('personal note');
});
