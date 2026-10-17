<?php

namespace App\Services;

use App\Models\SpeechAsset;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The only place `users.storage_bytes_used` / `uploads_in_flight` are
 * mutated (§9.1). Reservation is a single conditional `UPDATE`, never
 * check-then-act — the WHERE clause is the enforcement, and
 * `affectedRows === 0` is the only thing that means "over quota or too many
 * concurrent uploads." Release has all four paths §9.1 requires; missing
 * any one of them is how a user locks themselves out permanently.
 */
class QuotaService
{
    /**
     * Fallback only: used when the row read after a failed reserve() no
     * longer shows either condition as failed (see describeReserveFailure).
     */
    private const CONFLATED_RESERVE_MESSAGE = 'This upload would exceed your storage quota, or you already have 2 uploads in progress.';

    /** Reserve known server-received bytes without consuming a multipart slot. */
    public function reserveDirect(User $user, int $bytes): void
    {
        $affected = DB::update(
            'UPDATE users SET storage_bytes_used = storage_bytes_used + ? WHERE id = ? AND storage_bytes_used + ? <= quota_bytes',
            [$bytes, $user->id, $bytes],
        );

        if ($affected === 0) {
            throw ValidationException::withMessages(['audio' => ['This voice note would exceed your storage quota.']]);
        }
    }

    public function reconcileDirect(User $user, int $reservedBytes, int $realBytes): void
    {
        $this->clampStorageBytesUsed($user->id, $realBytes - $reservedBytes);
    }

    public function releaseDirect(User $user, int $bytes): void
    {
        $this->clampStorageBytesUsed($user->id, -$bytes);
    }

    /**
     * The clamp-to-zero shape shared by every single-column
     * storage_bytes_used adjustment in this class (this method's two
     * callers above, plus releaseOnSpeechDeleted below) — retyping this
     * SQL independently at each call site is exactly how a future edit
     * misses the clamp in one copy and reproduces the permanent-lockout
     * bug this class's own docblock warns about. releaseOnComplete/
     * releaseOnAbort deliberately do NOT go through this: they clamp
     * storage_bytes_used AND uploads_in_flight together in one atomic
     * two-column UPDATE, and splitting that into two separate statements
     * just to reuse this helper would trade a real atomicity guarantee for
     * a cosmetic one.
     */
    private function clampStorageBytesUsed(int $userId, int $delta): void
    {
        DB::update(
            'UPDATE users SET storage_bytes_used = CASE WHEN storage_bytes_used + ? < 0 THEN 0 ELSE storage_bytes_used + ? END WHERE id = ?',
            [$delta, $delta, $userId],
        );
    }

    /**
     * Reserve `$declaredBytes` and one upload slot for `$user`, atomically.
     * §7.8: on failure, the thrown message names the actual cause (quota vs
     * concurrency cap) — see describeReserveFailure() below — rather than
     * the single conflated string this used to always throw.
     *
     * @throws ValidationException if the reservation would exceed the quota
     *                             or the user already has 2 uploads in flight
     */
    public function reserve(User $user, int $declaredBytes): void
    {
        $affected = DB::update(
            'UPDATE users
                SET storage_bytes_used = storage_bytes_used + ?,
                    uploads_in_flight  = uploads_in_flight + 1
              WHERE id = ?
                AND storage_bytes_used + ? <= quota_bytes
                AND uploads_in_flight < 2',
            [$declaredBytes, $user->id, $declaredBytes],
        );

        if ($affected === 0) {
            throw ValidationException::withMessages(['file' => [$this->describeReserveFailure($user->id, $declaredBytes)]]);
        }
    }

    /**
     * §7.8: the UPDATE above has already failed and the request has
     * already been correctly denied by the time this runs — enforcement
     * is done. This method only decides what the error MESSAGE says, which
     * is advisory information for the client, not an enforcement decision.
     * That is why a second read is safe here even though this class's own
     * docblock says "never check-then-act" everywhere else: "check-then-act"
     * is a hazard when the check gates the act, because another request can
     * change the row in between and invalidate it. Here the act (the atomic
     * UPDATE, which remains the sole enforcement point) has already
     * happened and already failed; this read happens strictly after, purely
     * to explain a decision that's already final, so a race between this
     * read and some other request can at most make the error text slightly
     * stale — it can never let an over-quota or over-concurrency upload
     * through, since nothing here writes anything.
     */
    private function describeReserveFailure(int $userId, int $declaredBytes): string
    {
        $current = User::query()->whereKey($userId)->first(['storage_bytes_used', 'quota_bytes', 'uploads_in_flight']);

        if ($current === null) {
            return self::CONFLATED_RESERVE_MESSAGE;
        }

        $wouldExceedQuota = $current->storage_bytes_used + $declaredBytes > $current->quota_bytes;
        $overConcurrencyCap = $current->uploads_in_flight >= 2;

        // code-review finding: the two conditions are not mutually
        // exclusive — a user can be over quota AND at the concurrency cap
        // at the same time. Returning only the first one checked meant a
        // user in that state would free up space, retry, and be rejected
        // again with no indication the concurrency cap was the OTHER
        // reason — the exact "two problems, one string" failure this
        // split was built to fix, just with one message instead of two.
        if ($wouldExceedQuota && $overConcurrencyCap) {
            return 'This upload would exceed your storage quota, and you already have 2 uploads in progress. Free up space and wait for one to finish.';
        }

        if ($wouldExceedQuota) {
            return 'This upload would exceed your storage quota.';
        }

        if ($overConcurrencyCap) {
            return 'You already have 2 uploads in progress. Wait for one to finish before starting another.';
        }

        // Narrow TOCTOU: the row changed between the failed UPDATE and this
        // read (e.g. a concurrent release freed up room/a slot right after
        // our UPDATE lost the race) such that neither condition reads as
        // failed anymore. Fall back to the original conflated message
        // rather than asserting a specific cause we can no longer see.
        return self::CONFLATED_RESERVE_MESSAGE;
    }

    /**
     * Upload completed: release the in-flight slot and reconcile
     * `storage_bytes_used` by the delta between what the client declared at
     * `reserve()` and the asset's real `byte_size` — the declared value is
     * untrusted, and without this a client declaring 1 byte for a 40 MB
     * file evades the quota permanently (STEP-03 acceptance).
     */
    public function releaseOnComplete(SpeechAsset $asset, int $realByteSize): void
    {
        $delta = $realByteSize - (int) ($asset->client_declared_bytes ?? 0);

        DB::update(
            'UPDATE users
                SET storage_bytes_used = CASE WHEN storage_bytes_used + ? < 0 THEN 0 ELSE storage_bytes_used + ? END,
                    uploads_in_flight  = CASE WHEN uploads_in_flight - 1 < 0 THEN 0 ELSE uploads_in_flight - 1 END
              WHERE id = (SELECT user_id FROM speeches WHERE id = ?)',
            [$delta, $delta, $asset->speech_id],
        );
    }

    /**
     * Upload aborted or failed: give back both the declared bytes and the
     * in-flight slot — nothing was ultimately stored.
     */
    public function releaseOnAbort(SpeechAsset $asset): void
    {
        $declared = (int) ($asset->client_declared_bytes ?? 0);

        DB::update(
            'UPDATE users
                SET storage_bytes_used = CASE WHEN storage_bytes_used - ? < 0 THEN 0 ELSE storage_bytes_used - ? END,
                    uploads_in_flight  = CASE WHEN uploads_in_flight - 1 < 0 THEN 0 ELSE uploads_in_flight - 1 END
              WHERE id = (SELECT user_id FROM speeches WHERE id = ?)',
            [$declared, $declared, $asset->speech_id],
        );
    }

    /**
     * `media:reconcile`'s release path: a client vanished (closed tab, dead
     * phone) mid-upload. Same accounting as an abort, kept as a distinct
     * named method because it is called from a different place for a
     * different reason — see App\Console\Commands\MediaReconcile.
     */
    public function releaseOnReconcile(SpeechAsset $asset): void
    {
        $this->releaseOnAbort($asset);
    }

    /**
     * A speech was deleted: decrement `storage_bytes_used` by everything it
     * held (all of its assets' real `byte_size`, not the declared figure).
     */
    public function releaseOnSpeechDeleted(int $userId, int $totalBytesHeld): void
    {
        $this->clampStorageBytesUsed($userId, -$totalBytesHeld);
    }
}
