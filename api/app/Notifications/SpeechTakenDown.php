<?php

namespace App\Notifications;

use App\Models\Speech;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * PLAN-ADMIN-DASHBOARD.md §5.5. Takedown wrote `metadata: []` and
 * "nobody is ever notified — not on takedown, not on suspension", which
 * the plan promotes from "nice to have" to a Phase 1 defect: "a
 * moderation system with no statement of reasons and no notice to the
 * affected user is a product problem and, for a public platform,
 * plausibly a compliance one."
 *
 * Sibling of `CoachApplicationRejected` — same mail+database channel
 * shape, same queued dispatch, same `type` dot-notation string, which is
 * deliberate: a takedown and a rejected application are the two
 * adverse-decision notices on this platform and a speaker should
 * recognise them as the same kind of message.
 *
 * ⚠️ `$reason` is REQUIRED, not nullable, and that is the whole point of
 * this class: `SpeechResource`'s takedown action makes its `reason` field
 * `->required()` so there is no path that produces a takedown notice with
 * nothing to say. A nullable reason here would quietly re-open the hole
 * the plan asked to close.
 *
 * There is deliberately NO `->action()` button. `url("/speeches/{ulid}")`
 * is the obvious candidate and it would be a dead link: the speech is
 * soft-deleted by the time this sends and the API 410s a trashed speech
 * (§6.3), so the one thing the recipient would click is the one page
 * guaranteed not to render.
 *
 * `NotificationBell.tsx`'s `describe()` switch needs a matching
 * `speech.taken_down` case — a frontend concern tracked separately, same
 * as `CoachApplicationApproved`'s own docblock records for its type.
 */
class SpeechTakenDown extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        private readonly Speech $speech,
        private readonly string $reason,
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
            ->subject('Your speech has been taken down')
            ->line("An administrator has removed \"{$this->speech->title}\" from the library.")
            ->line("Reason given: {$this->reason}")
            ->line('Your commentary and review history are unaffected. If you believe this was a mistake, reply to this message and an administrator will look again.');
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
            'type' => 'speech.taken_down',
            'speech_id' => $this->speech->id,
            'speech_title' => $this->speech->title,
            'reason' => $this->reason,
        ];
    }
}
