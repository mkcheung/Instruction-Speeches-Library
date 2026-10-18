<?php

namespace App\Notifications;

use App\Models\Review;
use App\Support\FrontendUrl;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * MODERNIZATION_PLAN §7.5 (in-app bell) — dispatched by
 * App\Services\ReviewService::invite to the invited reviewer. Queued
 * (`ShouldQueue`) so a slow mail transport never blocks the invite request
 * itself.
 *
 * The action link points at `/dashboard`, not `/reviews` — there is no
 * `/reviews` route in the SPA at all (`web/src/App.tsx`); the reviewer's
 * dashboard is where pending invitations actually surface. Built with
 * `FrontendUrl::to()` (App\Support\FrontendUrl), not the bare `url()`
 * helper, which resolves against the API's own origin.
 */
class ReviewInvited extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(private readonly Review $review) {}

    /**
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        return ['mail', 'database'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $speech = $this->review->speech;
        $inviter = $this->review->invitedBy ?? $this->review->speechOwner;
        $title = $speech->title ?? 'a speech that has since been removed';

        // §7.6C.2 (continued): `$title` (speaker-set, up to 255 chars, no
        // character restriction — see CreateSpeechRequest/UpdateSpeechRequest)
        // and the inviter's own `first_name`/`last_name` (up to 60 chars
        // each, same freedom — see StepOneRequest) are exactly as
        // attacker-controlled as `invitation_message` was, and land in
        // the SAME markdown-rendered `->line()` below through the SAME
        // Blade-`{{ }}`-then-CommonMark pipeline (`{{ }}` escapes HTML
        // entities, not `[`/`]`/`(`/`)`). A speaker whose own name or
        // speech title is `[Click here](https://evil.example)` gets the
        // identical live phishing link invitation_message was just fixed
        // for. Unlike invitation_message, this text is meant to be shown,
        // so instead of suppressing it we backslash-escape CommonMark's
        // own ASCII-punctuation escape set first — the literal characters
        // still render (CommonMark strips a backslash before punctuation
        // it didn't need to escape), but none of them can open a link,
        // heading, emphasis run, or code span anymore.
        $escapeMarkdown = fn (?string $value): string => preg_replace('/([!-\/:-@\[-`{-~])/', '\\\\$1', $value ?? '') ?? '';
        $safeFirstName = $escapeMarkdown($inviter->first_name);
        $safeLastName = $escapeMarkdown($inviter->last_name);
        $safeTitle = $escapeMarkdown($title);

        return (new MailMessage)
            ->subject("{$inviter->first_name} invited you to review a speech")
            ->line("{$safeFirstName} {$safeLastName} has invited you to review \"{$safeTitle}\".")
            // §7.6C.2: the speaker's free-text `invitation_message` is
            // deliberately NOT interpolated into the mail body. Laravel's
            // Markdown mail layer escapes raw HTML and blocks
            // `javascript:`/`data:` link schemes, but it does not escape
            // CommonMark's own `[text](url)` link syntax — a speaker
            // writing `[Verify your account](https://phish.example)` as
            // their message would render as a live clickable link in
            // outgoing mail. The fix is to never render the free text at
            // all: point the reviewer at their dashboard, where the same
            // field is already rendered safely as an inert JSX text node
            // (`Dashboard.tsx`'s `{review.invitation_message}`).
            ->when($this->review->invitation_message, fn (MailMessage $mail) => $mail->line('They left you a personal note — open your dashboard to read it.'))
            ->action('View invitation', FrontendUrl::to('/dashboard'))
            ->line('You can accept or decline from your reviewer dashboard.');
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(object $notifiable): array
    {
        return $this->toDatabase($notifiable);
    }

    /**
     * @return array<string, mixed>
     */
    public function toDatabase(object $notifiable): array
    {
        $inviter = $this->review->invitedBy ?? $this->review->speechOwner;

        return [
            'type' => 'review.invited',
            'review_id' => $this->review->id,
            'speech_id' => $this->review->speech_id,
            'speech_title' => $this->review->speech?->title,
            'actor_name' => trim("{$inviter->first_name} {$inviter->last_name}"),
            'url' => FrontendUrl::to('/dashboard'),
        ];
    }
}
