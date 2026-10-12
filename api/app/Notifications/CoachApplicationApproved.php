<?php

namespace App\Notifications;

use App\Models\CoachApplication;
use App\Models\User;
use App\Support\FrontendUrl;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * STEP-12-FROZEN-CONTRACT.md §9. Sibling of `App\Notifications\
 * ReviewInvited` — same mail+database channel shape, same queued
 * dispatch. `type` string (`coach_application.approved`) matches the
 * existing `review.*` dot-notation precedent; `NotificationBell.tsx`'s
 * `describe()` switch needs a matching case added in the same PR as this
 * class (frontend concern, tracked separately).
 *
 * code-review finding: the `/profile` destination was itself wrong, not
 * just the host. `/profile` (`ProfileEdit.tsx`) is the private settings
 * form — it has no Coach badge, no reviewer-directory listing, nothing
 * this notification tells the recipient to go look at. The Coach badge
 * this class announces only renders on the public profile,
 * `/u/{username}` (`PublicProfile.tsx`, `App.tsx`'s `path="/u/:username"`).
 * Linked via the notifiable's own username — `$notifiable` here IS the
 * applicant (the one being notified), so no extra relation load is
 * needed. Built with `FrontendUrl::to()` (App\Support\FrontendUrl), not
 * bare `url()`, which resolves against the API's own origin, not the
 * SPA's.
 */
class CoachApplicationApproved extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(private readonly CoachApplication $application) {}

    /**
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        return ['mail', 'database'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        /** @var User $notifiable */
        $destination = $notifiable->username !== null
            ? FrontendUrl::to("/u/{$notifiable->username}")
            : FrontendUrl::to('/profile');

        return (new MailMessage)
            ->subject('Your coach application has been approved')
            ->line('An administrator has reviewed your submitted credentials and approved your coach application.')
            ->when($this->application->decision_reason, fn (MailMessage $mail) => $mail->line($this->application->decision_reason))
            ->action('View your profile', $destination)
            ->line('Your Coach badge is now visible on your profile and you appear in the reviewer directory.');
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
        /** @var User $notifiable */
        return [
            'type' => 'coach_application.approved',
            'coach_application_id' => $this->application->id,
            'url' => $notifiable->username !== null
                ? FrontendUrl::to("/u/{$notifiable->username}")
                : FrontendUrl::to('/profile'),
        ];
    }
}
