<?php

namespace App\Notifications;

use App\Support\FrontendUrl;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * §7.2.5 — dispatched to the reviewer by App\Services\ReviewService::revoke
 * and ::revokeAndPurge ONLY. Not for withdraw/abandon — those are the
 * reviewer's own acts, and notifying them of their own action is noise.
 *
 * The constructor takes plain scalars, never a `Review` instance. For
 * `revokeAndPurge` the review row is `DELETE`d inside the same transaction
 * that triggers this notification — by the time `DB::afterCommit()`'s
 * callback runs (let alone by the time a queue worker picks the job up),
 * the row is gone. `SerializesModels` (used by every `ShouldQueue`
 * notification) would try to refetch a model from the database on the
 * queue worker and fail, or serialize a stale in-memory instance with no
 * guarantee it rehydrates. Capturing the payload as scalars before the
 * delete, and taking only scalars here, sidesteps that for both call
 * sites uniformly.
 *
 * ⚠️ `type`/field names in `toArray`/`toDatabase` below are a frozen
 * contract shared with the frontend's `NotificationType` union and
 * `NotificationBell.tsx`'s `describe()` switch — built in parallel against
 * this exact shape. Do not rename or restructure without updating both.
 */
class ReviewAccessRevoked extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        private readonly int $reviewId,
        private readonly ?int $speechId,
        private readonly ?string $speechTitle,
        private readonly ?string $reason,
        private readonly bool $purged,
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
        $title = $this->speechTitle ?? 'a speech that has since been removed';

        $subject = $this->purged
            ? 'Your access and notes on a speech were removed'
            : 'Your access to a speech was revoked';

        $bodyLine = $this->purged
            ? "Your access to \"{$title}\" was removed, and your commentary and notes on it were deleted."
            : "Your access to \"{$title}\" was revoked.";

        $message = (new MailMessage)
            ->subject($subject)
            ->line($bodyLine)
            ->when($this->reason !== null, fn (MailMessage $mail) => $mail->line("Reason: {$this->reason}"));

        // A purged review's speech may still exist, but the reviewer has
        // no access to it anymore — same reasoning as a null speech id,
        // don't link them somewhere that will 403/404 them.
        if (! $this->purged && $this->speechId !== null) {
            $message = $message->action('View speech', FrontendUrl::to("/speeches/{$this->speechId}"));
        }

        return $message;
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
            'type' => 'review.access_revoked',
            'review_id' => $this->reviewId,
            'speech_id' => $this->speechId,
            'speech_title' => $this->speechTitle,
            'reason' => $this->reason,
            'purged' => $this->purged,
            'url' => (! $this->purged && $this->speechId !== null) ? FrontendUrl::to("/speeches/{$this->speechId}") : null,
        ];
    }
}
