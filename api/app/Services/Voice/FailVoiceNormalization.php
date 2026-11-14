<?php

namespace App\Services\Voice;

use App\Enums\SpeechAssetStatus;
use App\Enums\TranscriptStatus;
use App\Models\SpeechAsset;
use App\Services\QuotaService;
use App\Support\AnnotationTransactions;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-10-FROZEN-CONTRACT.md:347: "normalize failure asset=failed,
 * transcript=failed". The one settlement behind every normalization
 * failure: the processor's own exits, NormalizeVoiceNote::failed() (also
 * reached from VoiceNoteService::create), and media:reconcile's
 * hung-normalization sweep. Guarded (contract :351) so it never overwrites
 * a purge claim, another upload's temporary path, or an asset that already
 * left `processing`.
 */
class FailVoiceNormalization
{
    public const DETAIL = 'We had trouble processing this voice note. Please record it again.';

    public function __construct(private readonly QuotaService $quota) {}

    /** True when this call settled the failure; false when the asset had moved on or another call settled it. */
    public function execute(int $assetId, string $temporaryPath, string $code, string $detail = self::DETAIL): bool
    {
        /** @var array{disk: string, candidate_path: string|null}|null $outcome */
        $outcome = AnnotationTransactions::run(function () use ($assetId, $temporaryPath, $code, $detail): ?array {
            $fresh = SpeechAsset::query()->whereKey($assetId)
                ->where('status', SpeechAssetStatus::Processing->value)->whereNull('purge_claim_id')
                ->where('temporary_path', $temporaryPath)->lockForUpdate()->first();
            // temporary_byte_size is the once-only release sentinel: the first settlement nulls it.
            if ($fresh === null || $fresh->temporary_byte_size === null) {
                return null;
            }
            $reserved = (int) $fresh->temporary_byte_size;
            // Resolved under this lock: the annotation or review can be hard-deleted concurrently
            // (ReviewService::clearAnnotations/revokeAndPurge); a stale reviewer would skip the
            // release and leak the reservation for good.
            $reviewer = $fresh->voiceAnnotation()->first()?->review()->first()?->reviewer()->first();
            $candidatePath = $fresh->normalization_candidate_path;
            $fresh->update([
                'status' => SpeechAssetStatus::Failed->value, 'failure_code' => $code, 'failure_detail' => $detail,
                'temporary_byte_size' => null, 'byte_size' => 0,
            ]);
            $fresh->voiceAnnotation()->whereIn('transcript_status', TranscriptStatus::inFlight())->update([
                'transcript_status' => TranscriptStatus::Failed->value, 'transcript_failure_code' => null,
            ]);
            if ($reviewer !== null) {
                $this->quota->releaseDirect($reviewer, $reserved);
            }

            return ['disk' => $fresh->disk, 'candidate_path' => $candidatePath];
        });
        if ($outcome === null) {
            return false;
        }
        // Storage I/O stays outside the retryable transaction.
        $clean = true;
        foreach (SpeechAsset::voiceAssetCandidatePaths($temporaryPath, $outcome['candidate_path']) as $path) {
            $clean = (! Storage::disk($outcome['disk'])->exists($path) || Storage::disk($outcome['disk'])->delete($path)) && $clean;
        }
        if ($clean) {
            SpeechAsset::query()->whereKey($assetId)->where('status', SpeechAssetStatus::Failed->value)
                ->where('temporary_path', $temporaryPath)->update(['temporary_path' => null, 'normalization_candidate_path' => null]);
        }

        return true;
    }
}
