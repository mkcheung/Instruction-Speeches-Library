<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * IMPLEMENTATION-PLANS.md §7.5.6. Sibling of SpeechTakenDown (same
 * mail+database channel shape, same queued dispatch) but a DIFFERENT event
 * with different stakes:
 *
 *  - SpeechTakenDown is sent to the SPEECH OWNER, by an ADMIN, with a
 *    mandatory reason ("your speech was removed, here's why" — an adverse
 *    decision made against someone).
 *  - SpeechDeleted (this class) is sent to each REVIEWER, by the OWNER's
 *    own soft delete, with no reason owed ("the speech you were reviewing
 *    is gone" — the owner's own content decision, which the owner owes no
 *    reviewer a justification for).
 *
 * Constructor takes scalars (`int $speechId, string $speechTitle`), not a
 * `Speech` instance. The row is soft-deleted, not hard-deleted, so it is
 * still queryable via `withTrashed()` if a future change needs that — but
 * matching the scalar-capture precedent from ReviewAccessRevoked/
 * ReviewPublished is the safer, simpler default here too, since there is no
 * need to re-touch the model later.
 *
 * `type: 'speech.deleted'` (NOT `speech.taken_down`) — a different event,
 * a different audience, different copy.
 *
 * No `->action()` link, same reasoning SpeechTakenDown gives: the speech
 * 410s, so there is nowhere good to send a click.
 *
 * `NotificationBell.tsx`'s `describe()` switch needs a matching
 * `speech.deleted` case — a frontend concern, tracked the same way
 * SpeechTakenDown's docblock tracks its own `speech.taken_down` case.
 */
class SpeechDeleted extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        private readonly int $speechId,
        private readonly string $speechTitle,
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
        return (new MailMessage)
            ->subject('A speech you were reviewing has been removed')
            ->line("A speech you were reviewing, \"{$this->speechTitle}\", has been removed by its author.");
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
            'type' => 'speech.deleted',
            'speech_id' => $this->speechId,
            'speech_title' => $this->speechTitle,
        ];
    }
}
