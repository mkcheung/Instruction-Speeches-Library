<?php

return [

    /*
    |--------------------------------------------------------------------------
    | whisper.cpp binary + model (STEP-09-captions.md, frozen contract §6)
    |--------------------------------------------------------------------------
    |
    | Consulted only by App\Services\Captions\WhisperTranscriber — the
    | testing/CI binding is App\Services\Captions\FakeCaptionTranscriber,
    | which never shells out at all (mirrors TranscoderContract's
    | Fake/Ffmpeg split). `model_path` points at the read-only
    | `whisper-models` named volume mounted into the `whisper-worker`
    | compose service (compose.yaml) — never baked into any image, per
    | STEP-09.md's "mount them as a volume rather than baking them into
    | the image".
    |
    | `model_name` is recorded verbatim onto every speech_transcripts row
    | (§ acceptance: "model is recorded on every transcript") — it is NOT
    | read back from the binary/model file, since whisper.cpp's CLI output
    | doesn't self-report a stable model identifier; the deploy-time model
    | choice IS the identifier.
    |
    */

    'whisper_binary' => env('WHISPER_BINARY', '/usr/local/bin/whisper-cli'),

    'model_path' => env('WHISPER_MODEL_PATH', '/models/ggml-base.en.bin'),

    'model_name' => env('WHISPER_MODEL_NAME', 'whisper.cpp-base.en'),

    'language' => env('WHISPER_LANGUAGE', 'en'),

    // Wall-clock ceiling for one whisper.cpp invocation (App\Jobs\
    // GenerateCaptions's own $timeout is set above this, same ordering
    // TranscodeSpeechAsset keeps against `redis-long`'s retry_after).
    'timeout_seconds' => (int) env('WHISPER_TIMEOUT_SECONDS', 1800),

    /*
    |--------------------------------------------------------------------------
    | Recovery reconciler clocks (STEP-09-VERIFICATION-PLAN.md §4.1)
    |--------------------------------------------------------------------------
    |
    | Two SEPARATE, deliberately different clocks App\Console\Commands\
    | MediaReconcileCommand uses for `kind=captions` rows only — `updated_at`
    | is not a recovery clock (it changes on unrelated writes, e.g. a
    | speaker's edit). Both are overridable per-invocation via the command's
    | own `--caption-queue-wait-seconds`/`--caption-heartbeat-stale-seconds`
    | options (only the E2E harness's `APP_ENV=e2e`-only every-minute
    | schedule + smoke script does that, to observe these transitions in
    | under 90s — see routes/console.php); every other environment, and the
    | daily production schedule, relies on these config defaults untouched.
    |
    | `queue_wait_seconds`: how long a job may sit dispatched with no worker
    | ever having claimed it (`caption_started_at` still null) before the
    | reconciler fails it — "a separately configured, conservative maximum
    | queue wait," intentionally NOT tied to the 3600s job timeout, since a
    | job that's never even started hasn't consumed any of that budget.
    |
    | `heartbeat_stale_seconds`: 4200 = the 3600s effective GenerateCaptions
    | job timeout PLUS retry/storage/DB margin, exactly as the frozen
    | contract states — independent of how often the scheduler itself runs.
    | A started row only fails once its last WhisperTranscriber stage
    | heartbeat is at least this old.
    |
    */

    'queue_wait_seconds' => (int) env('WHISPER_QUEUE_WAIT_SECONDS', 900),

    'heartbeat_stale_seconds' => (int) env('WHISPER_HEARTBEAT_STALE_SECONDS', 4200),

    /*
    |--------------------------------------------------------------------------
    | model.lock path (STEP-09-VERIFICATION-PLAN.md §6.2/§6.3)
    |--------------------------------------------------------------------------
    |
    | Consulted only by the real-Whisper smoke tooling (tests/Feature/
    | Captions/RealWhisperAdapterSmokeTest.php,
    | App\Console\Commands\Captions\WhisperSmokeVerifyCommand) to assert a
    | produced transcript's `model` column equals docker/whisper/model.lock's
    | `model_id` — never read by WhisperTranscriber itself, which only ever
    | writes `model_name` above (an operator-set env var that must be KEPT
    | IN SYNC with model.lock by convention, not by this app reading the
    | file at transcribe-time).
    |
    | Defaults to the file's REPO-RELATIVE location (correct when Pest runs
    | straight from a checked-out working tree, e.g. a developer running
    | `./vendor/bin/pest` outside any container). Inside `whisper-worker`/
    | `whisper-smoke`, compose.yaml overrides this to the fixed in-image
    | path both Dockerfile stages copy the file to
    | (`/docker/whisper/model.lock` — the same path `whisper-model-init`
    | already uses for the same file), since neither image contains a
    | `docker/` directory relative to `api/`.
    |
    */

    'model_lock_path' => env('WHISPER_MODEL_LOCK', base_path('../docker/whisper/model.lock')),

    /*
    |--------------------------------------------------------------------------
    | Real Whisper smoke gate (STEP-09-VERIFICATION-PLAN.md §6.2/§6.3)
    |--------------------------------------------------------------------------
    |
    | The one gate `RealWhisperAdapterSmokeTest` (->skip()) and
    | App\Console\Commands\WhisperSmokeSeedCommand /
    | WhisperSmokeVerifyCommand all check before doing anything real —
    | true only inside compose.yaml's `whisper-smoke` service/profile or a
    | deliberate `RUNS_WHISPER_SMOKE=1` invocation, never in an ordinary
    | `./vendor/bin/pest` run.
    |
    */

    'runs_whisper_smoke' => env('RUNS_WHISPER_SMOKE') === '1',

    // Where RealWhisperAdapterSmokeTest exports bounded, sanitized process
    // diagnostics on failure (§6.2 item 6) — compose.yaml's `whisper-smoke`
    // service bind-mounts this to a host directory so the artifact
    // survives after `docker compose run --rm` exits.
    'smoke_artifact_dir' => env('WHISPER_SMOKE_ARTIFACT_DIR', sys_get_temp_dir().'/whisper-smoke-artifacts'),

];
