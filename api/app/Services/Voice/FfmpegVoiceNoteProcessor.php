<?php

namespace App\Services\Voice;

use App\Models\SpeechAsset;
use App\Services\QuotaService;
use Illuminate\Contracts\Process\ProcessResult;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

class FfmpegVoiceNoteProcessor implements VoiceNoteProcessorContract
{
    public function __construct(private readonly QuotaService $quota) {}

    public function process(SpeechAsset $asset, string $temporaryPath): bool
    {
        if ($asset->kind !== 'voice_note' || $asset->status !== 'processing') {
            return false;
        }
        $input = tempnam(sys_get_temp_dir(), 'voice_in_');
        $outputBase = tempnam(sys_get_temp_dir(), 'voice_out_');
        $output = $outputBase.'.m4a';
        $reserved = (int) ($asset->temporary_byte_size ?? $asset->byte_size);

        try {
            $bytes = Storage::disk($asset->disk)->get($temporaryPath);
            if ($bytes === null || file_put_contents($input, $bytes) === false) {
                return $this->fail($asset, $temporaryPath, $reserved, 'voice_storage_failed');
            }

            $filter = 'loudnorm=I=-16:TP=-1.5:LRA=11:dual_mono=true:print_format=json';
            $pass1 = Process::timeout(110)->run(['ffmpeg', '-nostdin', '-y', '-i', $input, '-af', $filter, '-f', 'null', '-']);
            $stats = $this->loudnormStats($pass1);
            if (! $pass1->successful() || $stats === null) {
                return $this->fail($asset, $temporaryPath, $reserved, 'voice_invalid_audio');
            }

            $pass2Filter = sprintf(
                'loudnorm=I=-16:TP=-1.5:LRA=11:dual_mono=true:measured_I=%s:measured_LRA=%s:measured_TP=%s:measured_thresh=%s:offset=%s:linear=true:print_format=summary',
                $stats['input_i'], $stats['input_lra'], $stats['input_tp'], $stats['input_thresh'], $stats['target_offset'],
            );
            $pass2 = Process::timeout(110)->run(['ffmpeg', '-nostdin', '-y', '-i', $input, '-map', '0:a:0', '-vn', '-af', $pass2Filter, '-ac', '1', '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '64k', '-movflags', '+faststart', $output]);
            if (! $pass2->successful() || ! is_file($output)) {
                return $this->fail($asset, $temporaryPath, $reserved, 'voice_normalization_failed');
            }

            $probe = Process::timeout(30)->run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', $output]);
            $duration = (float) trim($probe->output());
            if (! $probe->successful() || $duration <= 0) {
                return $this->fail($asset, $temporaryPath, $reserved, 'voice_invalid_audio');
            }
            if ($duration > 90.0) {
                return $this->fail($asset, $temporaryPath, $reserved, 'voice_duration_exceeded');
            }

            $finalPath = preg_replace('/\.m4a$/', '', $asset->path).'.'.Str::uuid().'.m4a';
            $claimed = DB::transaction(function () use ($asset, $temporaryPath, $finalPath): bool {
                $fresh = SpeechAsset::query()->whereKey($asset->id)->where('status', 'processing')
                    ->whereNull('purge_claim_id')->whereNull('normalization_candidate_path')
                    ->where('temporary_path', $temporaryPath)->lockForUpdate()->first();
                if ($fresh === null) {
                    return false;
                }
                $fresh->update(['normalization_candidate_path' => $finalPath]);

                return true;
            });
            if (! $claimed) {
                return false;
            }
            $normalized = file_get_contents($output);
            if ($normalized === false || ! Storage::disk($asset->disk)->put($finalPath, $normalized)) {
                return $this->fail($asset, $temporaryPath, $reserved, 'voice_storage_failed');
            }

            try {
                $written = DB::transaction(function () use ($asset, $temporaryPath, $finalPath, $duration, $normalized): bool {
                    $fresh = SpeechAsset::query()->whereKey($asset->id)->lockForUpdate()->first();
                    if ($fresh === null || $fresh->status !== 'processing' || $fresh->kind !== 'voice_note' || $fresh->temporary_path !== $temporaryPath || $fresh->normalization_candidate_path !== $finalPath || $fresh->purge_claim_id !== null) {
                        return false;
                    }
                    $fresh->voiceAnnotation()->update(['duration_seconds' => $duration]);
                    $fresh->update(['path' => $finalPath, 'normalization_candidate_path' => null, 'mime_type' => 'audio/mp4', 'byte_size' => strlen($normalized), 'duration_seconds' => $duration, 'status' => 'ready', 'failure_code' => null, 'failure_detail' => null]);

                    return true;
                });
            } catch (Throwable $exception) {
                // Candidate ownership remains persisted. Deleting our own
                // candidate is safe; failed()/reconcile can retry cleanup.
                Storage::disk($asset->disk)->delete($finalPath);
                throw $exception;
            }
            if (! $written) {
                $stillOurs = SpeechAsset::query()->whereKey($asset->id)->where('normalization_candidate_path', $finalPath)->exists();
                if ($stillOurs) {
                    Storage::disk($asset->disk)->delete($finalPath);
                }

                return false;
            }

            if (! Storage::disk($asset->disk)->delete($temporaryPath)) {
                return true;
            }
            DB::transaction(function () use ($asset, $temporaryPath, $reserved, $normalized): void {
                $fresh = SpeechAsset::query()->whereKey($asset->id)->where('status', 'ready')->where('temporary_path', $temporaryPath)->lockForUpdate()->first();
                if ($fresh === null || $fresh->temporary_byte_size === null) {
                    return;
                }
                // Resolved under this same lock, not the pre-ffmpeg $asset
                // snapshot from process()'s entry (up to ~220s earlier
                // across both loudnorm passes) — see fail()'s identical
                // comment below for why a stale reviewer silently drops
                // the quota release/reconcile on a concurrent delete.
                $reviewer = $fresh->voiceAnnotation()->first()?->review()->first()?->reviewer()->first();
                if ($reviewer !== null) {
                    $this->quota->reconcileDirect($reviewer, $reserved, strlen($normalized));
                }
                $fresh->update(['temporary_path' => null, 'temporary_byte_size' => null]);
            });

            return true;
        } finally {
            @unlink($input);
            @unlink($output);
            @unlink($outputBase);
        }
    }

    private function loudnormStats(ProcessResult $result): ?array
    {
        $text = $result->output()."\n".$result->errorOutput();
        if (! preg_match_all('/\{[^{}]*"input_i"[^{}]*\}/s', $text, $matches)) {
            return null;
        }
        $data = json_decode(end($matches[0]), true);
        foreach (['input_i', 'input_lra', 'input_tp', 'input_thresh', 'target_offset'] as $key) {
            if (! isset($data[$key])) {
                return null;
            }
        }

        return $data;
    }

    private function fail(SpeechAsset $asset, string $temporaryPath, int $reserved, string $code): bool
    {
        $candidatePath = null;
        $won = DB::transaction(function () use ($asset, $temporaryPath, $reserved, $code, &$candidatePath): bool {
            $fresh = SpeechAsset::query()->whereKey($asset->id)->where('status', 'processing')->whereNull('purge_claim_id')->where('temporary_path', $temporaryPath)->lockForUpdate()->first();
            if ($fresh === null || $fresh->temporary_byte_size === null) {
                return false;
            }
            $candidatePath = $fresh->normalization_candidate_path;
            $fresh->update([
                'status' => 'failed', 'failure_code' => $code,
                'failure_detail' => 'We had trouble processing this voice note. Please record it again.', 'temporary_byte_size' => null, 'byte_size' => 0,
            ]);
            $fresh->voiceAnnotation()->whereIn('transcript_status', ['pending', 'processing'])->update([
                'transcript_status' => 'failed', 'transcript_failure_code' => null,
            ]);
            // Resolved under this same lock — process()'s entry-time
            // snapshot can be up to ~220s stale across two loudnorm
            // passes by the time any of process()'s six call sites reach
            // this method, and the annotation/review it points at can be
            // concurrently hard-deleted in that window
            // (ReviewService::clearAnnotations/revokeAndPurge). Resolving
            // from a stale snapshot could find no reviewer even though the
            // row was live moments earlier, silently skipping the release
            // and leaking the reserved bytes out of the quota permanently.
            $reviewer = $fresh->voiceAnnotation()->first()?->review()->first()?->reviewer()->first();
            if ($reviewer !== null) {
                $this->quota->releaseDirect($reviewer, $reserved);
            }

            return true;
        });
        if (! $won) {
            return false;
        }
        $paths = SpeechAsset::voiceAssetCandidatePaths($temporaryPath, $candidatePath);
        $clean = true;
        foreach ($paths as $path) {
            $clean = (! Storage::disk($asset->disk)->exists($path) || Storage::disk($asset->disk)->delete($path)) && $clean;
        }
        if ($clean) {
            SpeechAsset::query()->whereKey($asset->id)->where('status', 'failed')->where('temporary_path', $temporaryPath)->update(['temporary_path' => null, 'normalization_candidate_path' => null]);
        }

        return false;
    }
}
