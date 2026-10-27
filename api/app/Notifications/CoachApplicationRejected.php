<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * STEP-12-FROZEN-CONTRACT.md §9. Sibling of CoachApplicationApproved /
 * App\Notifications\ReviewInvited — same shape.
 *
 * No `->action()` link and no `url` key in `toDatabase()` — unlike its
 * approved sibling, a rejection has no good destination page (there is
 * nothing new to view), so the `url` key is omitted entirely rather than
 * set to a page that isn't actually relevant.
 */
class CoachApplicationRejected extends Notification implements ShouldQueue
{
    use Queueable;

    /**
     * Immutable snapshot (ID + decision reason) captured at decision time, so
     * a later queued render never depends on a mutable model graph.
     */
    public function __construct(private readonly int $applicationId, private readonly ?string $reason = null) {}

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
            ->subject('An update on your coach application')
            ->line('An administrator has reviewed your submitted credentials and was not able to approve your coach application at this time.')
            ->when($this->reason, fn (MailMessage $mail) => $mail->line($this->reason))
            ->line('You may submit a new application at any time.');
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
            'type' => 'coach_application.rejected',
            'coach_application_id' => $this->applicationId,
        ];
    }
}
