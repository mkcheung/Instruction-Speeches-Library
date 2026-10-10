<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * PLAN-ADMIN-DASHBOARD.md §5.5, the suspension half of the same defect
 * `SpeechTakenDown` covers for content: a suspension "kicks people off
 * the platform" (§0) and told them nothing at all.
 *
 * ⚠️ The `database` channel is a real constraint here, not a copy-paste
 * of the sibling notifications' channel list. §5.1 makes suspension
 * actually end the session (logout + Sanctum token revocation), so a
 * suspended user CANNOT sign in to read their in-app notification bell —
 * the `mail` channel is the only one they can actually reach, and it is
 * the reason this notice exists. `database` is kept so the record is
 * there when they are reinstated, and because a notification with no
 * durable trace is a worse audit story than one with both.
 *
 * No `->action()` link, for the same reason as `SpeechTakenDown`: every
 * authenticated page is exactly what the recipient has just lost access
 * to.
 *
 * `$reason` is required rather than nullable — see `SpeechTakenDown`'s
 * docblock for why the non-nullable type is the enforcement and the
 * Filament `->required()` is only the UI half of it.
 *
 * `NotificationBell.tsx`'s `describe()` switch needs a matching
 * `user.suspended` case (frontend, tracked separately).
 */
class AccountSuspended extends Notification implements ShouldQueue
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
            ->subject('Your account has been suspended')
            ->line('An administrator has suspended your account. You have been signed out and cannot sign in again while the suspension stands.')
            ->line("Reason given: {$this->reason}")
            ->line('Nothing has been deleted. A suspension is reversible, and your speeches, commentary and connections are all still here. If you believe this was a mistake, reply to this message and an administrator will review it.');
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
            'type' => 'user.suspended',
            'reason' => $this->reason,
        ];
    }
}
