<?php

namespace App\Notifications;

use App\Models\Review;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * MODERNIZATION_PLAN §7.5 — dispatched by App\Services\ReviewService::decline
 * to the speech owner.
 */
class ReviewDeclined extends Notification implements ShouldQueue
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
        $reviewer = $this->review->reviewer;
        $speech = $this->review->speech;

        return (new MailMessage)
            ->subject("{$reviewer?->first_name} declined your review invitation")
            ->line("{$reviewer?->first_name} {$reviewer?->last_name} declined your invitation to review \"{$speech->title}\".")
            ->action('Invite someone else', url("/speeches/{$speech->ulid}"));
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
        $reviewer = $this->review->reviewer;

        return [
            'type' => 'review.declined',
            'review_id' => $this->review->id,
            'speech_id' => $this->review->speech_id,
            'speech_title' => $this->review->speech->title,
            'actor_name' => $reviewer !== null ? trim("{$reviewer->first_name} {$reviewer->last_name}") : null,
        ];
    }
}
