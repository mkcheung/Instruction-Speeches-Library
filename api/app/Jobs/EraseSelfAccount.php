<?php

namespace App\Jobs;

use App\Models\Review;
use App\Models\User;
use App\Services\Voice\EraseReviewerVoiceNotes;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

class EraseSelfAccount implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    /**
     * `erasure_started_at` / `voice_erasure_started_at` are set BEFORE the
     * work and are hard gates that nothing in the application ever clears
     * (ReviewService::invite and VoiceNoteService::create both 409 on
     * them). That ordering is deliberate — it stops new voice notes racing
     * the erasure — but it means a failure here is not a no-op: the user is
     * locked out of being a reviewer permanently while their reviewer
     * identity, the very thing the erasure was for, is still attached.
     *
     * So this job must actually get to retry. The default worker
     * `--timeout=60` (compose.yaml's `queue-worker`) is not enough for a
     * reviewer with hundreds of voice notes — each one is two storage
     * round-trips plus two transactions — and with no backoff all three
     * attempts burned within milliseconds against the same transient
     * object-store blip. `EraseReviewerVoiceNotes::execute()` re-plucks the
     * remaining annotations on every call, so a retry resumes rather than
     * repeats.
     */
    public int $timeout = 600;

    /** @return list<int> */
    public function backoff(): array
    {
        return [30, 120];
    }

    public function __construct(public int $userId)
    {
        $this->afterCommit = true;
        // 600s of work cannot sit on the `redis` connection, whose
        // `retry_after` is 90 — the queue would release a second worker
        // onto this job while the first was still legitimately deleting
        // objects, and two concurrent erasures of the same reviewer would
        // double-release quota.
        $this->connection = 'redis-long';
    }

    public function handle(EraseReviewerVoiceNotes $voiceNotes): void
    {
        $user = User::query()->find($this->userId);
        if ($user === null) {
            return;
        }
        DB::transaction(function () use ($user): void {
            // Only stamp a start time once: on a retry the original instant
            // is the truthful one, and overwriting it would misreport how
            // long the erasure has actually been in flight.
            User::query()->whereKey($user->id)->lockForUpdate()->whereNull('erasure_started_at')->update(['erasure_started_at' => now()]);
            Review::query()->where('reviewer_id', $user->id)->whereNull('voice_erasure_started_at')->lockForUpdate()->get()->each->update(['voice_erasure_started_at' => now()]);
        });
        $counts = $voiceNotes->execute($user);
        DB::transaction(fn () => Review::query()->where('reviewer_id', $user->id)->update(['reviewer_id' => null]));
        Log::info('erase-self voice slice completed', ['user_id' => $user->id, ...$counts]);
    }

    /**
     * Without this, a job that exhausted its tries left no signal anywhere:
     * the user sat permanently gated, their reviewer identity retained,
     * their voice notes half-deleted, and nothing but a row in
     * `failed_jobs` to say so. There is no safe automatic recovery — the
     * gates must NOT be cleared, since audio may already be gone — so this
     * records the state loudly enough for an operator to finish it by hand.
     */
    public function failed(Throwable $exception): void
    {
        Log::error('erase-self FAILED: reviewer identity is still attached and the account remains gated.', [
            'user_id' => $this->userId,
            'exception' => $exception->getMessage(),
            'remediation' => 'Re-dispatch EraseSelfAccount for this user id; execute() resumes from whatever is left.',
        ]);
    }
}
