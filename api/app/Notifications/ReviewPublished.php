<?php

namespace App\Notifications;

use App\Models\Review;
use App\Support\FrontendUrl;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * MODERNIZATION_PLAN §7.5 — dispatched by
 * App\Services\ReviewService::publish to the speech owner, the FIRST time
 * a review is ever published (see that method's own comment for the
 * `first_published_at`-was-null-before-this-call debounce: `publish()` is
 * incremental and can be called repeatedly by the same reviewer, and only
 * the review's first-ever publish is the "a coach finished feedback"
 * moment worth announcing). Sibling of `ReviewAccepted`/`ReviewDeclined` —
 * same mail+database channel shape, same queued dispatch.
 *
 * The action link uses `FrontendUrl::to()` (App\Support\FrontendUrl), not
 * the bare `url()` helper, which resolves against the API's own origin —
 * see that class's docblock. It also uses `$speech->id`, not
 * `$speech->ulid`: the SPA route (`web/src/App.tsx`'s
 * `path="/speeches/:id"`, read as `Number(id)`) expects the numeric
 * database id.
 */
class ReviewPublished extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        private readonly Review $review,
        private readonly int $publishedCount,
    ) {}

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
            ->subject("{$reviewer?->first_name} published feedback on your speech")
            ->line("{$reviewer?->first_name} {$reviewer?->last_name} published feedback on \"{$title}\".");

        return $speech === null ? $message : $message->action('View speech', FrontendUrl::to("/speeches/{$speech->id}"));
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
            'type' => 'review.published',
            'review_id' => $this->review->id,
            'speech_id' => $this->review->speech_id,
            'speech_title' => $speech?->title,
            'actor_name' => $reviewer !== null ? trim("{$reviewer->first_name} {$reviewer->last_name}") : null,
            'published_count' => $this->publishedCount,
            'url' => $speech === null ? null : FrontendUrl::to("/speeches/{$speech->id}"),
        ];
    }
}
