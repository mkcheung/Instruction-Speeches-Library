<?php

namespace App\Support;

use App\Models\SpeechAsset;
use App\Services\StorageObjectRemover;
use Illuminate\Support\Str;

/**
 * The claim token every speech-asset purge stamps before it deletes an
 * object (STEP-10-FROZEN-CONTRACT.md:90). Only the token: each caller keeps
 * its own locks and lock order, predicates, status change, transaction
 * wrapper, payer and amount (PLAN-DRY-PLATFORM.md M3).
 */
final readonly class AssetPurgeClaim
{
    /** @param  list<string>  $paths */
    private function __construct(public string $id, public int $assetId, public string $disk, public array $paths) {}

    /**
     * Call inside the caller's transaction, with `$asset` locked. Reuses an
     * existing claim, so a retry finishes the row it already claimed.
     * `$attributes` go into the same UPDATE.
     *
     * @param  array<string, mixed>  $attributes
     */
    public static function stamp(SpeechAsset $asset, array $attributes = []): self
    {
        $id = $asset->purge_claim_id ?? (string) Str::uuid();
        $asset->update([...$attributes, 'purge_claim_id' => $id]);

        return new self($id, $asset->id, $asset->disk, SpeechAsset::voiceAssetCandidatePaths($asset->temporary_path, $asset->normalization_candidate_path, $asset->path));
    }

    /** Outside any transaction. Throws, leaving the claimed row for a retry, if an object survives. */
    public function deleteObjects(string $failureMessage): void
    {
        app(StorageObjectRemover::class)->deleteExisting($this->disk, $this->paths, $failureMessage);
    }

    /** Inside the caller's finalize transaction: the asset, locked, only while this claim still owns it. */
    public function lockAsset(): ?SpeechAsset
    {
        return SpeechAsset::query()->whereKey($this->assetId)->where('purge_claim_id', $this->id)->lockForUpdate()->first();
    }
}
