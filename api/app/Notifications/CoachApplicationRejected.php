<?php

namespace App\Notifications;

use App\Models\CoachApplication;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * STEP-12-FROZEN-CONTRACT.md §9. Sibling of CoachApplicationApproved /
 * App\Notifications\ReviewInvited — same shape.
 */
class CoachApplicationRejected extends Notification implements ShouldQueue
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
            ->subject('An update on your coach application')
            ->line('An administrator has reviewed your submitted credentials and was not able to approve your coach application at this time.')
            ->when($this->application->decision_reason, fn (MailMessage $mail) => $mail->line($this->application->decision_reason))
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
            'coach_application_id' => $this->application->id,
        ];
    }
}
