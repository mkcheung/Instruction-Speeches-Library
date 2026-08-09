<?php

namespace App\Jobs;

use App\Models\SpeechAsset;
use App\Services\Transcoding\TranscoderContract;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * §9.2's non-negotiable #1: `after_commit => true`. Without it, this job
 * dispatched inside the upload-complete controller's `DB::transaction()`
 * can be picked up by the queue worker before that transaction commits —
 * "model not found" on the very asset the request just created. Setting it
 * on the job itself (rather than relying on the queue connection default)
 * means it holds regardless of which connection config is active.
 *
 * Never creates the asset row (§9.2's idempotency guarantee) — the
 * upload-complete controller action already created it `status=processing`
 * before dispatching; this only updates it.
 */
class TranscodeSpeechAsset implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * Set in the constructor, not as a re-declared property: `Queueable`
     * (used above) already declares an untyped `$afterCommit`, and a typed
     * re-declaration in the class using it is a fatal "incompatible
     * property" error at class-composition time, not just a lint warning.
     */
    public function __construct(public int $speechAssetId)
    {
        $this->afterCommit = true;
    }

    public function handle(TranscoderContract $transcoder): void
    {
        $asset = SpeechAsset::query()->find($this->speechAssetId);

        // Exit guard: the speech (and cascade-deleted asset) may be gone by
        // the time this runs. Nothing to transcode into.
        if ($asset === null || $asset->status !== 'processing') {
            return;
        }

        $transcoder->transcode($asset);
    }
}
