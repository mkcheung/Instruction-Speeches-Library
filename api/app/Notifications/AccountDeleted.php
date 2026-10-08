<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * PLAN-ADMIN-DASHBOARD.md §5.5 names three verbs, not two: "a required
 * reason field on takedown/suspend/**delete** plus a notification." Phase
 * 1 built the first two (`SpeechTakenDown`, `AccountSuspended`) and could
 * not build this one, because §6.2's delete/restore row actions did not
 * exist yet — `UserDeletionService::softDelete()` had zero callers, so
 * there was no moment at which a notice could be sent. §6.2 wires the
 * button; this is the notice that goes with it.
 *
 * ⚠️ The `mail` channel is the load-bearing one, for a sharper reason
 * than `AccountSuspended`'s. §5.1's `CheckUserIsActive` treats
 * `deleted_at` as terminal-for-access exactly like `suspended_at`, so the
 * recipient is signed out and cannot sign back in to read an in-app
 * notification. `database` is kept for the same two reasons the
 * suspension notice keeps it: the record is there when they are restored
 * (§6.2's `restore()` makes this reversible), and a notification with no
 * durable trace is a worse audit story than one with both.
 *
 * No `->action()` link: every authenticated page is precisely what the
 * recipient has just lost access to — same reasoning as its two siblings.
 *
 * ⚠️ The wording draws the distinction that matters legally and
 * practically. This is NOT erasure: `AccountErasureService` /
 * `PrivacyEraseCommand` anonymize the row and delete every stored byte,
 * and §6.3's GDPR erase UI is cut from v1 precisely because that verb is
 * irreversible. A soft delete is a 30-day moderation grace period with
 * every speech, review and connection still on disk, so the notice must
 * not read as "your data is gone" — a user who believes their work was
 * destroyed behaves very differently from one who knows it is recoverable.
 *
 * `$reason` is required rather than nullable, the same enforcement
 * `SpeechTakenDown`'s docblock spells out: the Filament `->required()` is
 * only the UI half, and a nullable type here would quietly re-open the
 * hole §5.5 asked to close.
 *
 * There is deliberately no counterpart notice on `restore()`.
 * `UserResource::toggleSuspend` is the precedent and it is consistent:
 * §5.5's notification duty attaches to the ADVERSE decision, and a
 * reinstatement announces itself the moment the person can sign in again.
 *
 * `NotificationBell.tsx`'s `describe()` switch needs a matching
 * `user.deleted` case — frontend, tracked separately, same as
 * `AccountSuspended`'s `user.suspended`.
 */
class AccountDeleted extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(private readonly string $reason) {}

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
            ->subject('Your account has been deleted')
            ->line('An administrator has deleted your account. You have been signed out and cannot sign in again.')
            ->line("Reason given: {$this->reason}")
            ->line('This is reversible for a limited grace period: nothing has been erased, and your speeches, commentary and connections are all still here. If you believe this was a mistake, reply to this message and an administrator will review it.');
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
            'type' => 'user.deleted',
            'reason' => $this->reason,
        ];
    }
}
