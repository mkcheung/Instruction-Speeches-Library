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

class EraseSelfAccount implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public function __construct(public int $userId)
    {
        $this->afterCommit = true;
    }

    public function handle(EraseReviewerVoiceNotes $voiceNotes): void
    {
        $user = User::query()->find($this->userId);
        if ($user === null) {
            return;
        }
        DB::transaction(function () use ($user): void {
            User::query()->whereKey($user->id)->lockForUpdate()->update(['erasure_started_at' => now()]);
            Review::query()->where('reviewer_id', $user->id)->lockForUpdate()->get()->each->update(['voice_erasure_started_at' => now()]);
        });
        $counts = $voiceNotes->execute($user);
        DB::transaction(fn () => Review::query()->where('reviewer_id', $user->id)->update(['reviewer_id' => null]));
        Log::info('erase-self voice slice completed', ['user_id' => $user->id, ...$counts]);
    }
}
