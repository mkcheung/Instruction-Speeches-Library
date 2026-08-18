<?php

use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Services\Captions\CaptionAttemptTracker;
use App\Services\Captions\Vtt;
use App\Services\Captions\WhisperTranscriber;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-09-VERIFICATION-PLAN.md §6.2: "a fast diagnostic for the adapter,
 * not STEP-09's final queued-system proof" — it instantiates
 * `WhisperTranscriber` DIRECTLY (bypassing `AppServiceProvider`'s
 * testing-environment `FakeCaptionTranscriber` binding, which is what
 * every other Pest test in this repo goes through) and runs the real
 * committed spoken-audio fixture through real `ffmpeg` audio extraction
 * and a real `whisper-cli` binary against a real mounted model file.
 *
 * This only does anything when actually run inside the `whisper-smoke`
 * Docker target (compose.yaml's `whisper-smoke` service, gated behind the
 * `whisper-smoke` profile) — the ONLY place `whisper-cli` and the model
 * volume both exist. `RUNS_WHISPER_SMOKE=1` is that service's env var;
 * plain `./vendor/bin/pest` run anywhere else (including CI's default
 * lane) skips this file entirely via `->skip()` below, so it can never
 * accidentally try to shell out to a binary that isn't there.
 *
 * `WhisperTranscriber` has no `App\Jobs\GenerateCaptions` in front of it
 * here — no queue, no `redis-long`, no real Postgres/SeaweedFS. That is
 * intentional: §6.3's queued sign-off (scripts/captions:whisper-smoke-*
 * console commands + `scripts/whisper-smoke-stack.sh queued`) is what
 * proves the container/queue/storage seams; this file's only job is the
 * adapter/CLI seam in isolation.
 */
function sanitizeWhisperSmokeDiagnostics(string $text, string $tempDir): string
{
    // Bounded: STEP-09 verification plan §6.2 item 6 — "bounded process
    // diagnostics ... while ... unbounded stderr [is] not" allowed to
    // leak. 4000 bytes is generous for spotting a real ffmpeg/whisper-cli
    // failure without ever dumping a pathological multi-MB stderr stream
    // into a committed-adjacent artifact directory.
    $bounded = mb_substr($text, 0, 4000);

    // No secrets/signed URLs: strip any query string (where a SigV4
    // signature/token would live) and the scheme+host of any URL,
    // collapsing it to a stable marker instead of silently keeping the
    // path tail (which could itself carry a token in some other
    // parameter, e.g. `X-Amz-Signature=`).
    $noUrls = preg_replace('/https?:\/\/\S+/i', '<url-redacted>', $bounded) ?? $bounded;

    // No full local paths: this process's own scratch temp dir (where
    // WhisperTranscriber's tempnam() files and this test's fixture copy
    // live) is the one path fragment guaranteed to appear in real
    // ffmpeg/whisper-cli stderr — collapse it to a stable marker rather
    // than the real filesystem path.
    $noTempPaths = str_replace($tempDir, '<tmp>', $noUrls);

    // Also collapse any other absolute-looking path segment (best-effort,
    // not a full leak-proof parser — this is a diagnostic aid, not a
    // security boundary for genuinely sensitive data) so a stray
    // `/var/www/html/...` or similar doesn't ride along verbatim.
    return preg_replace('#(?:/[\w.\-]+){3,}#', '<path-redacted>', $noTempPaths) ?? $noTempPaths;
}

it('sanitizes signed URLs, full paths, and truncates unbounded output before export', function () {
    $tmp = '/tmp/whisper-smoke-abc123';
    // Realistic shape: the sensitive bits (a signed URL, temp/app paths)
    // appear early in real ffmpeg/whisper-cli stderr, with the pathological
    // "unbounded" tail coming AFTER — truncation happening before
    // redaction (§6.2 item 6's "bounded ... while ... unbounded stderr
    // [is] not" ordering) must not itself be what hides them from this
    // assertion.
    $raw = 'see https://example-bucket.s3.amazonaws.com/speeches/42/source?X-Amz-Signature=super-secret-token'
        .' at '.$tmp.'/whisper_src_abcdef.tmp'
        .' also /var/www/html/storage/app/private/whatever/deep/path.bin'
        .' '.str_repeat('x', 5000);

    $sanitized = sanitizeWhisperSmokeDiagnostics($raw, $tmp);

    expect(mb_strlen($sanitized))->toBeLessThanOrEqual(4000);
    expect($sanitized)->not->toContain('X-Amz-Signature');
    expect($sanitized)->not->toContain('super-secret-token');
    expect($sanitized)->not->toContain($tmp);
    expect($sanitized)->not->toContain('/var/www/html/storage');
    expect($sanitized)->toContain('<url-redacted>');
});

it('transcribes a real spoken-audio fixture end-to-end through whisper.cpp', function () {
    Storage::fake('media');

    $fixturePath = __DIR__.'/../../fixtures/whisper-smoke/spoken-fixture.m4a';
    expect(is_file($fixturePath))->toBeTrue("Missing fixture: {$fixturePath}");

    $speech = Speech::factory()->create(['captions_enabled' => true]);

    $sourcePath = 'speeches/whisper-smoke/source.m4a';
    $written = Storage::disk('media')->put($sourcePath, file_get_contents($fixturePath));
    expect($written)->toBeTrue('Seeding the fake media disk with the fixture failed.');

    $source = SpeechAsset::factory()->for($speech)->create([
        'kind' => 'source',
        'format' => 'mp4',
        'disk' => 'media',
        'path' => $sourcePath,
        'mime_type' => 'audio/mp4',
        'status' => 'ready',
    ]);

    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'status' => 'processing',
    ]);

    // §4.1's attempt-token contract landed on this branch mid-session
    // (docker/whisper/model.lock's sibling migration
    // 2026_08_17_100004_add_attempt_tracking_to_speech_assets_table): every
    // real WhisperTranscriber::transcribe() call must supply the SAME
    // attempt id currently recorded on the row, or its own guarded
    // writes (App\Services\Captions\CaptionAttemptTracker::compareAndSet)
    // silently no-op the row as "superseded" and this test would see
    // status stay 'processing' forever instead of reaching 'ready'.
    $attemptId = CaptionAttemptTracker::rotate($captions);

    $artifactDir = rtrim((string) config('captions.smoke_artifact_dir'), '/');

    try {
        (new WhisperTranscriber)->transcribe($source, $captions, $attemptId);

        $captions->refresh();

        expect($captions->status)
            ->toBe('ready', "WhisperTranscriber did not reach 'ready' (failure_code={$captions->failure_code}, failure_detail={$captions->failure_detail}).");

        $vttContent = Storage::disk($captions->disk)->get($captions->path);
        expect($vttContent)->not->toBeNull('Canonical VTT missing from storage.');
        expect(trim((string) $vttContent))->not->toBe('');

        $cues = Vtt::parse((string) $vttContent);
        expect($cues)->not->toBeEmpty('whisper.cpp produced a VTT with zero cues.');

        $transcripts = SpeechTranscript::query()->where('speech_id', $speech->id)->get();
        expect($transcripts)->toHaveCount(1);

        /** @var SpeechTranscript $transcript */
        $transcript = $transcripts->first();

        expect(trim($transcript->body))->not->toBe('');
        expect($transcript->segments)->not->toBeEmpty();
        expect($transcript->source)->toBe('whisper');
        expect($transcript->language)->toBe((string) config('captions.language'));

        // NOTE: the verification plan (§6.2 item 5, §4.1) also calls for
        // asserting caption/transcript "revision fields agree" (a SHA-256
        // `content_revision`/`caption_revision` pair). Those columns do
        // not exist yet on this branch — §4.1's frozen-contract addendum
        // and its migration are a SEPARATE, not-yet-built task — so no
        // such assertion is made here. Add it once that migration lands;
        // asserting a column that doesn't exist would just be a fatal
        // SQL/property error, not a meaningful skip.

        // "model equals the locked engine+weights identifier" — read
        // straight from docker/whisper/model.lock (config('captions.
        // model_lock_path'), which resolves to a real in-image path inside
        // the whisper-smoke container — see compose.yaml) rather than
        // hard-coding the id a second time in this test, so the two can
        // never silently drift apart.
        $lockPath = (string) config('captions.model_lock_path');
        expect(is_file($lockPath))->toBeTrue("Missing model.lock: {$lockPath}");
        $lock = json_decode((string) file_get_contents($lockPath), true);
        expect($transcript->model)->toBe((string) $lock['model_id']);
        expect((string) config('captions.model_name'))->toBe((string) $lock['model_id'],
            'WHISPER_MODEL_NAME must be set to model.lock\'s model_id for this smoke run — see compose.yaml\'s whisper-smoke service.');

        // Small normalized keyword subset (§6.2 item 4) — NOT an exact
        // transcript/timestamp comparison, which is explicitly out of
        // scope. See the fixture's README for why these four words were
        // chosen and why only a subset is required.
        $normalized = strtolower((string) preg_replace('/[^a-z0-9\s]/i', ' ', $transcript->body));
        $keywords = ['toastmasters', 'confidence', 'public', 'speaking'];
        $matched = array_values(array_filter($keywords, fn (string $word): bool => str_contains($normalized, $word)));

        expect(count($matched))->toBeGreaterThanOrEqual(2,
            'Expected at least 2 of ['.implode(', ', $keywords).'] in normalized transcript body, got ['.implode(', ', $matched)."]. Full body: {$transcript->body}");
    } catch (Throwable $e) {
        // §6.2 item 6: export bounded, sanitized diagnostics on failure —
        // best-effort, wrapped so a diagnostics-export bug can never mask
        // the real test failure being rethrown below.
        try {
            @mkdir($artifactDir, 0755, true);

            $tempDir = sys_get_temp_dir();
            $diagnosticExtraction = Process::timeout(30)->run([
                (string) config('captions.whisper_binary'), '--help',
            ]);

            $diagnostics = implode("\n", [
                '=== RealWhisperAdapterSmokeTest failure diagnostics ===',
                'exception: '.$e::class.': '.$e->getMessage(),
                'caption_asset.status: '.($captions->status ?? 'unknown'),
                'caption_asset.failure_code: '.($captions->failure_code ?? 'null'),
                'caption_asset.failure_detail: '.($captions->failure_detail ?? 'null'),
                'whisper-cli --help exit code: '.$diagnosticExtraction->exitCode(),
                'whisper-cli --help output (bounded): '.mb_substr($diagnosticExtraction->output().$diagnosticExtraction->errorOutput(), 0, 1000),
            ]);

            $sanitized = sanitizeWhisperSmokeDiagnostics($diagnostics, $tempDir);
            file_put_contents(
                $artifactDir.'/adapter-smoke-diagnostics-'.date('Ymd-His').'.txt',
                $sanitized
            );
        } catch (Throwable) {
            // Never let diagnostics export itself hide the real failure.
        }

        throw $e;
    }
})->skip(
    fn () => ! config('captions.runs_whisper_smoke'),
    'Real Whisper smoke test — set RUNS_WHISPER_SMOKE=1 (only true inside the whisper-smoke container, where whisper-cli and the mounted model actually exist) to run it. See STEP-09-VERIFICATION-PLAN.md §6.2.'
);
