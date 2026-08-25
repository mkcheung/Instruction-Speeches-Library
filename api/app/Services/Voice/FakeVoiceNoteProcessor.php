<?php

namespace App\Services\Voice;

use App\Models\SpeechAsset;
use App\Services\QuotaService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class FakeVoiceNoteProcessor implements VoiceNoteProcessorContract
{
    public function __construct(private readonly QuotaService $quota) {}

    public function process(SpeechAsset $asset, string $temporaryPath): bool
    {
        if ($asset->status !== 'processing' || $asset->kind !== 'voice_note') {
            return false;
        }
        $reserved = (int) ($asset->temporary_byte_size ?? $asset->byte_size);
        $candidate = preg_replace('/\.m4a$/', '', $asset->path).'.'.Str::uuid().'.m4a';
        $claimed = SpeechAsset::query()->whereKey($asset->id)->where('status', 'processing')
            ->whereNull('purge_claim_id')->whereNull('normalization_candidate_path')
            ->where('temporary_path', $temporaryPath)
            ->update(['normalization_candidate_path' => $candidate]);
        if ($claimed !== 1) {
            return false;
        }
        Storage::disk($asset->disk)->put($candidate, 'fake-m4a');
        $won = DB::transaction(function () use ($asset, $temporaryPath, $candidate): bool {
            $fresh = SpeechAsset::query()->whereKey($asset->id)->where('status', 'processing')->whereNull('purge_claim_id')->where('temporary_path', $temporaryPath)->lockForUpdate()->first();
            if ($fresh === null || $fresh->normalization_candidate_path !== $candidate) {
                return false;
            }
            $fresh->voiceAnnotation()->update(['duration_seconds' => 1.0]);
            $fresh->update(['path' => $candidate, 'normalization_candidate_path' => null, 'mime_type' => 'audio/mp4', 'byte_size' => 8, 'duration_seconds' => 1.0, 'status' => 'ready']);

            return true;
        });
        if (! $won) {
            if (SpeechAsset::query()->whereKey($asset->id)->where('normalization_candidate_path', $candidate)->exists()) {
                Storage::disk($asset->disk)->delete($candidate);
            }

            return false;
        }
        $reviewer = $asset->voiceAnnotation()->first()?->review()->first()?->reviewer()->first();
        if (Storage::disk($asset->disk)->delete($temporaryPath)) {
            DB::transaction(function () use ($asset, $temporaryPath, $reviewer, $reserved): void {
                $fresh = SpeechAsset::query()->whereKey($asset->id)->where('temporary_path', $temporaryPath)->lockForUpdate()->first();
                if ($fresh === null || $fresh->temporary_byte_size === null) {
                    return;
                }
                if ($reviewer !== null) {
                    $this->quota->reconcileDirect($reviewer, $reserved, 8);
                }
                $fresh->update(['temporary_path' => null, 'temporary_byte_size' => null]);
            });
        }

        return true;
    }
}
