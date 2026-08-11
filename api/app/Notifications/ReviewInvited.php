<?php

namespace App\Notifications;

use App\Models\Review;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * MODERNIZATION_PLAN §7.5 (in-app bell) — dispatched by
 * App\Services\ReviewService::invite to the invited reviewer. Queued
 * (`ShouldQueue`) so a slow mail transport never blocks the invite request
 * itself.
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

        return (new MailMessage)
            ->subject("{$inviter->first_name} invited you to review a speech")
            ->line("{$inviter->first_name} {$inviter->last_name} has invited you to review \"{$speech->title}\".")
            ->when($this->review->invitation_message, fn (MailMessage $mail) => $mail->line("\"{$this->review->invitation_message}\""))
            ->action('View invitation', url('/reviews'))
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
            'speech_title' => $this->review->speech->title,
            'actor_name' => trim("{$inviter->first_name} {$inviter->last_name}"),
        ];
    }
}
