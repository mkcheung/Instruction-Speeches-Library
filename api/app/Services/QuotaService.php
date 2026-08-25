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
        $delta = $realBytes - $reservedBytes;
        DB::update(
            'UPDATE users SET storage_bytes_used = CASE WHEN storage_bytes_used + ? < 0 THEN 0 ELSE storage_bytes_used + ? END WHERE id = ?',
            [$delta, $delta, $user->id],
        );
    }

    public function releaseDirect(User $user, int $bytes): void
    {
        DB::update(
            'UPDATE users SET storage_bytes_used = CASE WHEN storage_bytes_used - ? < 0 THEN 0 ELSE storage_bytes_used - ? END WHERE id = ?',
            [$bytes, $bytes, $user->id],
        );
    }

    /**
     * Reserve `$declaredBytes` and one upload slot for `$user`, atomically.
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
            throw ValidationException::withMessages([
                'file' => ['This upload would exceed your storage quota, or you already have 2 uploads in progress.'],
            ]);
        }
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
        DB::update(
            'UPDATE users
                SET storage_bytes_used = CASE WHEN storage_bytes_used - ? < 0 THEN 0 ELSE storage_bytes_used - ? END
              WHERE id = ?',
            [$totalBytesHeld, $totalBytesHeld, $userId],
        );
    }
}
