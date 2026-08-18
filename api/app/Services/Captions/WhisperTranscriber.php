<?php

namespace App\Services\Captions;

use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;

/**
 * The dev/prod binding (App\Providers\AppServiceProvider), mirroring
 * App\Services\Transcoding\FfmpegTranscoder's shape exactly: shells out to
 * a real binary via `Process::timeout()->run([...])`, never throws (writes
 * a `failed` status with a user-safe `failure_code` instead — a thrown
 * exception here would be a job retry, not a visible Failed state), and
 * never touches anything outside the one asset row + transcript row it
 * owns.
 *
 * whisper.cpp (not faster-whisper — see the frozen STEP-09 contract §6 for
 * why) wants a 16kHz mono WAV, not the arbitrary source container this
 * product accepts, so this class extracts audio with ffmpeg first (the
 * "extracted-audio sibling asset" STEP-09.md/the task brief describe) —
 * a local scratch file, never persisted as its own speech_assets row: only
 * the resulting VTT is durable.
 *
 * NOT exercised against a real whisper.cpp binary or real model weights in
 * this environment (no `whisper-cli` binary and no GGUF model file are
 * present in this sandbox) — see this class's own tests, which fake
 * Process the same way FfmpegTranscoderTest fakes ffmpeg/ffprobe, and the
 * final report's explicit "unverified by running" caveat.
 */
class WhisperTranscriber implements CaptionTranscriberContract
{
    public function __construct(private readonly TranscriptDeriver $deriver = new TranscriptDeriver) {}

    public function transcribe(SpeechAsset $sourceAsset, SpeechAsset $captionsAsset, string $attemptId): void
    {
        // ffmpeg needs a `.wav`-suffixed output path to infer the WAV
        // muxer, so the audio scratch file can't use tempnam()'s raw
        // returned path directly — same "unlink the placeholder, use a
        // suffixed sibling path" pattern `$outputBase`/`$outputVtt` below
        // already use, applied consistently here too. The bug this fixes:
        // the old code called `tempnam(...).'.wav'` WITHOUT unlinking the
        // original tempnam'd placeholder first, so that zero-byte file was
        // silently leaked on local disk on every single run (only the
        // `.wav` sibling ever got cleaned up in `finally`).
        $localSource = tempnam(sys_get_temp_dir(), 'whisper_src_');
        $audioBase = tempnam(sys_get_temp_dir(), 'whisper_audio_');
        @unlink($audioBase);
        $localAudio = $audioBase.'.wav';
        $outputBase = tempnam(sys_get_temp_dir(), 'whisper_out_');
        @unlink($outputBase); // whisper.cpp writes {$outputBase}.vtt itself
        $outputVtt = $outputBase.'.vtt';

        try {
            $sourceStream = Storage::disk($sourceAsset->disk)->readStream($sourceAsset->path);

            if ($sourceStream === null) {
                $this->fail($captionsAsset, $attemptId, 'audio_extraction_failed', 'We had trouble reading the audio from this speech.');

                return;
            }

            $localHandle = fopen($localSource, 'wb');

            if ($localHandle === false) {
                fclose($sourceStream);
                $this->fail($captionsAsset, $attemptId, 'audio_extraction_failed', 'We had trouble reading the audio from this speech.');

                return;
            }

            // Streamed copy, not `Storage::get()` buffered whole into
            // memory first: a multi-hundred-MB source video must not be
            // held in PHP memory just to land it on local disk for ffmpeg.
            $copied = stream_copy_to_stream($sourceStream, $localHandle);
            fclose($localHandle);
            fclose($sourceStream);

            if ($copied === false) {
                $this->fail($captionsAsset, $attemptId, 'audio_extraction_failed', 'We had trouble reading the audio from this speech.');

                return;
            }

            // §4.1's first stage-boundary heartbeat: about to shell out to
            // FFmpeg, which can itself take a noticeable slice of the
            // overall 3600s job timeout on a large source. A no-op if some
            // other transaction (disable, manual edit, a fresher re-enable)
            // already took this row away from this attempt.
            CaptionAttemptTracker::heartbeat($captionsAsset->id, $attemptId);

            // 16kHz mono PCM WAV: whisper.cpp's documented required input
            // format for its CLI (no on-the-fly resampling inside the
            // binary itself).
            $extract = Process::timeout(300)->run([
                'ffmpeg', '-nostdin', '-y',
                '-i', $localSource,
                '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
                $localAudio,
            ]);

            if (! $extract->successful()) {
                $this->fail($captionsAsset, $attemptId, 'audio_extraction_failed', 'We had trouble reading the audio from this speech.');

                return;
            }

            // Second stage-boundary heartbeat: about to run whisper-cli
            // itself, the long-running step this whole clock exists for
            // (`captions.timeout_seconds`, up to 1800s).
            CaptionAttemptTracker::heartbeat($captionsAsset->id, $attemptId);

            $whisper = Process::timeout((int) config('captions.timeout_seconds'))->run([
                (string) config('captions.whisper_binary'),
                '-m', (string) config('captions.model_path'),
                '-l', (string) config('captions.language'),
                '-f', $localAudio,
                '-ovtt',
                '-of', $outputBase,
            ]);

            if (! $whisper->successful() || ! file_exists($outputVtt)) {
                $this->fail($captionsAsset, $attemptId, 'transcription_failed', 'We had trouble captioning this speech. Please try again.');

                return;
            }

            $vttContent = file_get_contents($outputVtt);

            if ($vttContent === false) {
                $this->fail($captionsAsset, $attemptId, 'transcription_failed', 'We had trouble captioning this speech. Please try again.');

                return;
            }

            $cues = Vtt::parse($vttContent);
            $derived = $this->deriver->derive($cues);

            // Third stage-boundary heartbeat: whisper-cli has finished and
            // parsing succeeded, about to take the row lock and write.
            CaptionAttemptTracker::heartbeat($captionsAsset->id, $attemptId);

            // Guarded write, same idempotency shape STEP-04's
            // writeFinalStatus() uses: whisper.cpp can run for minutes, and
            // a speaker can PUT a manual edit (CaptionService::update,
            // which takes this same lock) while it's in flight. Without
            // re-checking the row is still `processing` under the lock,
            // this would unconditionally overwrite the speaker's edit with
            // stale whisper output the moment the job finally finishes.
            // The edit wins — this write is simply skipped, not retried.
            //
            // captions-settings gap fix: this same `status === 'processing'`
            // re-check is ALSO what stops a disabled-mid-flight attempt
            // from ever publishing a `ready` result — no separate
            // `captions_enabled` check is needed here.
            // App\Services\Captions\EnsureCaptionJob::disable() takes the
            // exact same `SpeechAsset::whereKey(...)->lockForUpdate()` and,
            // if the row is still `processing` when it gets the lock, flips
            // it straight to `failed`/`captions_disabled` atomically.
            // Whichever of the two transactions (this one, or
            // EnsureCaptionJob::disable()) acquires the row lock first
            // wins; the other one's guard below then correctly no-ops,
            // because by the time it gets the lock the status is no longer
            // `processing` either way.
            //
            // §4.1 adds a second half to that same guard: `caption_attempt_id`
            // must still equal `$attemptId` too, not just `status`. Without
            // it, a disable -> re-enable cycle that lands WHILE this write is
            // in flight would still look like a plain `processing` row to
            // this check (the new attempt is also `processing`) and this
            // stale attempt A could publish stale whisper output over
            // attempt B's row.
            DB::transaction(function () use ($captionsAsset, $vttContent, $derived, $attemptId) {
                /** @var SpeechAsset|null $fresh */
                $fresh = SpeechAsset::query()->whereKey($captionsAsset->id)->lockForUpdate()->first();

                if ($fresh === null || $fresh->status !== 'processing' || $fresh->caption_attempt_id !== $attemptId) {
                    return;
                }

                if (! Storage::disk($fresh->disk)->put($fresh->path, $vttContent)) {
                    // Rolls back this transaction (nothing committed) and
                    // is caught below, outside the transaction, so the
                    // asset resolves to `failed` rather than `ready` over
                    // a VTT that never actually landed on disk.
                    throw new CaptionStorageWriteException("Failed writing VTT to disk for caption asset {$fresh->id}.");
                }

                // STEP-09-VERIFICATION-PLAN.md §4.1: the SAME shared
                // helper CaptionService/E2ECaptionsSeeder use, computed
                // over the exact bytes just written above — a fresh
                // whisper run and a later manual edit must never disagree
                // about what "this VTT's revision" means.
                $revision = CaptionRevision::compute($vttContent);

                $fresh->update([
                    'status' => 'ready',
                    // The content was just written above, so its length is
                    // known without a second disk/S3 stat round trip.
                    'byte_size' => strlen($vttContent),
                    'content_revision' => $revision,
                ]);

                SpeechTranscript::query()->updateOrCreate(
                    ['speech_id' => $fresh->speech_id],
                    [
                        ...$derived,
                        'language' => (string) config('captions.language'),
                        'model' => (string) config('captions.model_name'),
                        'source' => 'whisper',
                        'caption_revision' => $revision,
                    ],
                );
            });
        } catch (InvalidVttException $e) {
            // whisper.cpp produced output this product's own VTT reader
            // can't parse — treat identically to any other transcription
            // failure rather than persisting an asset row nothing else can
            // safely read.
            Log::warning('WhisperTranscriber: whisper.cpp produced unparseable VTT.', [
                'caption_asset_id' => $captionsAsset->id,
                'exception' => $e->getMessage(),
            ]);
            $this->fail($captionsAsset, $attemptId, 'transcription_failed', 'We had trouble captioning this speech. Please try again.');
        } catch (CaptionStorageWriteException $e) {
            Log::warning('WhisperTranscriber: writing the generated VTT to storage failed.', [
                'caption_asset_id' => $captionsAsset->id,
                'exception' => $e->getMessage(),
            ]);
            $this->fail($captionsAsset, $attemptId, 'transcription_failed', 'We had trouble captioning this speech. Please try again.');
        } finally {
            // Every local scratch path this method creates, cleaned up on
            // both the success and failure paths — including the
            // whisper.cpp output `.vtt`, which lives outside the disk
            // Storage abstraction entirely and would otherwise leak on
            // every single run.
            @unlink($localSource);
            @unlink($localAudio);
            @unlink($outputVtt);
        }
    }

    private function fail(SpeechAsset $captionsAsset, string $attemptId, string $code, string $detail): void
    {
        // Same guard as the success path: don't flip a row back to
        // `failed` if a speaker already hand-wrote captions (CaptionService
        // ::update) while this whisper attempt was still running — and
        // (§4.1) don't flip it either if a disable -> re-enable already
        // rotated a newer attempt id onto this row.
        DB::transaction(function () use ($captionsAsset, $attemptId, $code, $detail) {
            /** @var SpeechAsset|null $fresh */
            $fresh = SpeechAsset::query()->whereKey($captionsAsset->id)->lockForUpdate()->first();

            if ($fresh === null || $fresh->status !== 'processing' || $fresh->caption_attempt_id !== $attemptId) {
                return;
            }

            $fresh->update([
                'status' => 'failed',
                'failure_code' => $code,
                'failure_detail' => $detail,
            ]);
        });
    }
}
