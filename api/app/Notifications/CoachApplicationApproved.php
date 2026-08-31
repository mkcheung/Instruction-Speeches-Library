<?php

namespace App\Notifications;

use App\Models\CoachApplication;
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
        return (new MailMessage)
            ->subject('Your coach application has been approved')
            ->line('An administrator has reviewed your submitted credentials and approved your coach application.')
            ->when($this->application->decision_reason, fn (MailMessage $mail) => $mail->line($this->application->decision_reason))
            ->action('View your profile', url('/profile'))
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
        return [
            'type' => 'coach_application.approved',
            'coach_application_id' => $this->application->id,
        ];
    }
}
