<?php

namespace App\Notifications;

use App\Models\Review;
use App\Support\FrontendUrl;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * MODERNIZATION_PLAN §7.5 — dispatched by App\Services\ReviewService::decline
 * to the speech owner.
 *
 * The action link uses `FrontendUrl::to()` (App\Support\FrontendUrl), not
 * the bare `url()` helper, which resolves against the API's own origin —
 * see that class's docblock. It also uses `$speech->id`, not
 * `$speech->ulid`: the SPA route (`web/src/App.tsx`'s
 * `path="/speeches/:id"`, read as `Number(id)`) expects the numeric
 * database id.
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
        $title = $speech->title ?? 'a speech that has since been removed';

        $message = (new MailMessage)
            ->subject("{$reviewer?->first_name} declined your review invitation")
            ->line("{$reviewer?->first_name} {$reviewer?->last_name} declined your invitation to review \"{$title}\".");

        return $speech === null ? $message : $message->action('Invite someone else', FrontendUrl::to("/speeches/{$speech->id}"));
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
        $speech = $this->review->speech;

        return [
            'type' => 'review.declined',
            'review_id' => $this->review->id,
            'speech_id' => $this->review->speech_id,
            'speech_title' => $speech?->title,
            'actor_name' => $reviewer !== null ? trim("{$reviewer->first_name} {$reviewer->last_name}") : null,
            'url' => $speech === null ? null : FrontendUrl::to("/speeches/{$speech->id}"),
        ];
    }
}
