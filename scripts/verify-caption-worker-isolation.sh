#!/usr/bin/env bash
#
# STEP-09-VERIFICATION-PLAN.md §4.2 point 3: "against a disposable compose
# stack, enqueue transcode and caption work for the same real source, keep
# `caption-test-worker` stopped, run only the transcode worker, and assert
# video reaches `ready` while captions remain queued/`processing`; then
# start/release the deterministic caption worker and require `ready`. This
# — not a seeded state or queue-name assertion — is the temporal
# acceptance proof."
#
# A seeded `status='ready'`/`status='processing'` row proves nothing about
# independence — both rows could be hand-set to any value regardless of
# whether the two queues are actually decoupled. This script instead
# dispatches the REAL `App\Jobs\TranscodeSpeechAsset` (consumed by the REAL
# `ffmpeg-worker` against the REAL ffmpeg/ffprobe binaries) and the REAL
# `App\Jobs\GenerateCaptions` for the same source asset, exactly as
# `SpeechUploadController::complete` does on upload completion (this script
# calls the identical `EnsureCaptionJob::ensureForUpload()` service, not a
# hand-rolled dispatch, so it can never silently diverge from production's
# own creation path). It then proves — by *observing the queue actually
# drain or not*, not by reading a static seed — that captions cannot
# progress while `caption-test-worker` is stopped, and DOES progress the
# instant it is started and released.
#
# Requires the E2E stack already up under APP_ENV=e2e
# (`./scripts/e2e-stack.sh up`) — this script does not start/stop the
# stack itself, only the `caption-test-worker` service within it (started
# here, stopped again on every exit path per §7's last line: "The
# worker-isolation script finishes by draining the held captions job with
# the deterministic fake transcriber so no queued work leaks into later
# tests").
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT="speechcoach-e2e"
# Distinctive, timestamped title — outside E2ECaptionsSeeder's fixed
# 9401-9409/9501+ range and Playwright's other fixed-ID fixtures — so this
# can never collide with or be mistaken for a browser-suite row.
SMOKE_TITLE="caption-worker-isolation-$(date +%s)-$$"

VIDEO_READY_TIMEOUT=60
CAPTIONS_READY_TIMEOUT=60
POLL_INTERVAL=2
# §4.2 point 3's "and again after a short additional wait, to show it is
# NOT silently progressing" — a fixed, short, explicitly-evidentiary wait,
# not a substitute for the bounded polls above.
STILL_PROCESSING_CONFIRM_SECONDS=5

_compose() {
  docker compose -p "$PROJECT" -f compose.yaml -f compose.e2e.yaml "$@"
}

log() { echo "==> $*" >&2; }
fail() { echo "!!! $*" >&2; exit 1; }

SPEECH_ID=""
CAPTIONS_ASSET_ID=""
VIDEO_ASSET_ID=""

# Runs on every exit path (success, `fail`, or an unexpected error) — not
# just failure, unlike scripts that only clean up on the failure branch.
# §7's explicit requirement: caption-test-worker must return to stopped
# regardless of how this script ends, "so no queued work leaks into later
# tests."
cleanup() {
  rc=$?
  log "cleanup: stopping caption-test-worker"
  _compose stop caption-test-worker >/dev/null 2>&1 || log "cleanup: 'stop caption-test-worker' itself failed; inspect 'docker compose -p $PROJECT ps' by hand"

  if [ -n "$SPEECH_ID" ]; then
    log "cleanup: removing smoke speech $SPEECH_ID (cascade-deletes its assets/transcript), its owning smoke user, and its written media objects"
    _compose exec -T app php artisan tinker --execute="
        \$speech = App\Models\Speech::find(${SPEECH_ID});
        if (\$speech !== null) {
            \$disk = Illuminate\Support\Facades\Storage::disk('media');
            \$userId = \$speech->user_id;
            foreach (\$speech->assets as \$asset) {
                \$disk->delete(\$asset->path);
            }
            \$disk->deleteDirectory('speeches/'.\$speech->ulid);
            \$speech->delete();
            App\Models\User::whereKey(\$userId)->delete();
        }
        echo 'cleaned'.PHP_EOL;
    " >/dev/null 2>&1 || log "cleanup: failed to remove smoke speech $SPEECH_ID — remove it by hand"
  fi

  exit "$rc"
}
trap cleanup EXIT

log "confirming caption-test-worker is stopped before enqueuing anything"
STATE="$(_compose ps --format '{{.State}}' caption-test-worker 2>/dev/null || true)"
if [ "$STATE" = "running" ]; then
  fail "caption-test-worker is already running — expected it stopped by 'e2e-stack.sh up'. Refusing to start the isolation measurement against a stack in an unknown state."
fi
log "caption-test-worker confirmed stopped (state: '${STATE:-absent}')"

log "seeding a real source asset (committed fixture MP4) and dispatching the real transcode + caption jobs: $SMOKE_TITLE"
# `set -e` on a failing command inside a plain `X="$(...)"` assignment kills
# the script on THIS line, before any of the diagnostic `fail "...: $SEED_OUTPUT"`
# calls below ever run — silently swallowing exactly the PHP/Docker error
# a reader needs. Disable errexit for just this one capture, merge stderr
# into the same stream (a PHP fatal/exception inside tinker otherwise never
# reaches $SEED_OUTPUT at all), and fail loudly with the full output once
# back under `set -e`.
set +e
SEED_OUTPUT="$(_compose exec -T app php artisan tinker --execute="
    // Model factories (App\Models\Speech::factory(), etc.) call the global
    // fake()/Faker\Generator, which lives in fakerphp/faker — a
    // require-dev-only package. This 'app' container is built from the
    // 'vendor' Dockerfile stage's \`composer install --no-dev\`, so
    // fake() does not exist here ('Call to undefined function
    // Database\Factories\fake()'). E2ECaptionsSeeder/E2ESeeder hit the
    // same constraint and solve it the same way: build rows with plain
    // ::create() and explicit values, never a factory, against this
    // image.
    // 'email_verified_at' deliberately omitted — it is NOT in User's
    // #[Fillable(...)] list (app/Models/User.php), and
    // Model::preventSilentlyDiscardingAttributes(!isProduction()) makes
    // mass-assigning a non-fillable attribute throw
    // MassAssignmentException outside production, which APP_ENV=e2e is.
    // This smoke user only ever owns a Speech FK — it never authenticates
    // — so an unverified email is irrelevant here.
    \$user = App\Models\User::create([
        'email' => 'caption-worker-isolation-'.Illuminate\Support\Str::uuid().'@e2e-smoke.test',
        'password' => Illuminate\Support\Facades\Hash::make('password'),
    ]);
    // 'is_example' omitted — not in Speech's #[Fillable(...)] list either,
    // and the column is NOT NULL DEFAULT FALSE at the DB level; nothing
    // below ever reads \$speech->is_example, so the unhydrated in-memory
    // attribute never matters. 'captions_enabled' is different and MUST be
    // set explicitly, even though it also defaults true at the DB level:
    // Eloquent's ::create() does not re-fetch server-side column defaults
    // onto the in-memory model after INSERT, so \$speech->captions_enabled
    // would stay null (not true) in PHP — and EnsureCaptionJob::
    // ensureForUpload() below checks that exact in-memory attribute
    // (`! \$speech->captions_enabled`), so a null there makes it return
    // null immediately, which is exactly the bug this comment is warning
    // against reintroducing.
    \$speech = App\Models\Speech::create([
        'user_id' => \$user->id,
        'title' => '${SMOKE_TITLE}',
        'captions_enabled' => true,
    ]);

    \$fixturePath = base_path('tests/fixtures/e2e-captions/caption-fixture.mp4');
    \$bytes = file_get_contents(\$fixturePath);
    if (\$bytes === false) {
        fwrite(STDERR, 'could not read committed fixture at '.\$fixturePath.PHP_EOL);
        exit(1);
    }

    \$disk = Illuminate\Support\Facades\Storage::disk('media');
    \$sourcePath = 'e2e-smoke/worker-isolation/'.Illuminate\Support\Str::uuid().'/source.mp4';
    \$written = \$disk->put(\$sourcePath, \$bytes, ['ContentType' => 'video/mp4']);
    if (! \$written) {
        fwrite(STDERR, 'Storage::disk(media)->put() failed for '.\$sourcePath.PHP_EOL);
        exit(1);
    }

    \$source = \$speech->assets()->create([
        'kind' => 'source',
        'format' => 'mp4',
        'disk' => 'media',
        'path' => \$sourcePath,
        'original_filename' => 'caption-fixture.mp4',
        'mime_type' => 'video/mp4',
        'byte_size' => strlen(\$bytes),
        'status' => 'ready',
        'is_primary' => false,
    ]);

    // Same shape SpeechUploadController::complete uses: create the
    // 'processing' video row, dispatch TranscodeSpeechAsset for it, then
    // call the SAME EnsureCaptionJob::ensureForUpload() service upload
    // completion calls — never a hand-rolled GenerateCaptions::dispatch()
    // that could silently drift from what production actually does.
    \$video = \$speech->assets()->create([
        'kind' => 'video',
        'format' => 'mp4',
        'disk' => 'media',
        'path' => \"speeches/{\$speech->ulid}/{\$speech->ulid}/720p.mp4\",
        'status' => 'processing',
        'is_primary' => true,
    ]);

    App\Jobs\TranscodeSpeechAsset::dispatch(\$video->id);

    \$captions = app(App\Services\Captions\EnsureCaptionJob::class)->ensureForUpload(\$speech);
    if (\$captions === null) {
        fwrite(STDERR, 'EnsureCaptionJob::ensureForUpload() returned null — captions_enabled default must be true'.PHP_EOL);
        exit(1);
    }
    if (\$captions->caption_attempt_id === null) {
        fwrite(STDERR, 'captions asset has no caption_attempt_id after ensureForUpload()'.PHP_EOL);
        exit(1);
    }

    echo \$speech->id.'|'.\$video->id.'|'.\$captions->id.'|'.\$captions->caption_attempt_id.PHP_EOL;
" 2>&1 | tr -d '\r')"
SEED_RC=$?
set -e
[ "$SEED_RC" -eq 0 ] || fail "seeding tinker command exited $SEED_RC:
$SEED_OUTPUT"

RESULT_LINE="$(echo "$SEED_OUTPUT" | tail -n1)"
SPEECH_ID="$(echo "$RESULT_LINE" | cut -d'|' -f1)"
VIDEO_ASSET_ID="$(echo "$RESULT_LINE" | cut -d'|' -f2)"
CAPTIONS_ASSET_ID="$(echo "$RESULT_LINE" | cut -d'|' -f3)"
ATTEMPT_ID="$(echo "$RESULT_LINE" | cut -d'|' -f4)"

[ -n "$SPEECH_ID" ] && [ "$SPEECH_ID" -gt 0 ] 2>/dev/null || fail "failed to seed the smoke speech (no speech id returned):
$SEED_OUTPUT"
[ -n "$VIDEO_ASSET_ID" ] && [ "$VIDEO_ASSET_ID" -gt 0 ] 2>/dev/null || fail "failed to create the video asset:
$SEED_OUTPUT"
[ -n "$CAPTIONS_ASSET_ID" ] && [ "$CAPTIONS_ASSET_ID" -gt 0 ] 2>/dev/null || fail "failed to create the captions asset:
$SEED_OUTPUT"
[ -n "$ATTEMPT_ID" ] || fail "no caption_attempt_id returned:
$SEED_OUTPUT"

log "speech id: $SPEECH_ID / video asset id: $VIDEO_ASSET_ID / captions asset id: $CAPTIONS_ASSET_ID / attempt id: $ATTEMPT_ID"

query_asset_status() {
  local asset_id="$1"
  # Called inside the poll loops below under `set -e` — a bare failing
  # command substitution there would kill the whole script on one transient
  # `docker compose exec` hiccup instead of letting the loop's own timeout
  # govern retries. Disable errexit for just this call and fall back to
  # 'MISSING' (never a stale prior value) on a nonzero exit.
  set +e
  local out
  out="$(_compose exec -T app php artisan tinker --execute="
      \$a = App\Models\SpeechAsset::find(${asset_id});
      echo (\$a->status ?? 'MISSING').PHP_EOL;
  " 2>&1 | tr -d '\r' | tail -n1)"
  local rc=$?
  set -e
  [ "$rc" -eq 0 ] && [ -n "$out" ] && echo "$out" || echo "MISSING"
}

log "polling up to ${VIDEO_READY_TIMEOUT}s for the video to reach 'ready' via the REAL ffmpeg-worker, with caption-test-worker still stopped"
DEADLINE=$((SECONDS + VIDEO_READY_TIMEOUT))
VIDEO_STATUS=""
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  VIDEO_STATUS="$(query_asset_status "$VIDEO_ASSET_ID")"
  [ "$VIDEO_STATUS" = "ready" ] && break
  if [ "$VIDEO_STATUS" = "failed" ]; then
    FAILURE="$(_compose exec -T app php artisan tinker --execute="
        \$a = App\Models\SpeechAsset::find(${VIDEO_ASSET_ID});
        echo (\$a->failure_code ?? '').'|'.(\$a->failure_detail ?? '').PHP_EOL;
    " | tr -d '\r' | tail -n1)"
    fail "video asset $VIDEO_ASSET_ID failed instead of reaching 'ready': $FAILURE"
  fi
  sleep "$POLL_INTERVAL"
done

[ "$VIDEO_STATUS" = "ready" ] || fail "video asset $VIDEO_ASSET_ID did not reach 'ready' within ${VIDEO_READY_TIMEOUT}s (last observed status: '${VIDEO_STATUS:-unknown}') — is ffmpeg-worker running and consuming redis-long/transcode?"
log "video reached 'ready' (real ffmpeg-worker, real transcode)"

log "asserting captions remain queued/processing with caption-test-worker still stopped"
CAPTIONS_STATUS="$(query_asset_status "$CAPTIONS_ASSET_ID")"
if [ "$CAPTIONS_STATUS" != "processing" ]; then
  fail "captions asset $CAPTIONS_ASSET_ID is '$CAPTIONS_STATUS', expected 'processing' — either it progressed with caption-test-worker stopped (isolation broken) or it failed independently"
fi
log "captions confirmed 'processing' immediately after video reached ready"

log "waiting ${STILL_PROCESSING_CONFIRM_SECONDS}s and re-checking — captions must NOT have silently progressed"
sleep "$STILL_PROCESSING_CONFIRM_SECONDS"
CAPTIONS_STATUS="$(query_asset_status "$CAPTIONS_ASSET_ID")"
[ "$CAPTIONS_STATUS" = "processing" ] || fail "captions asset $CAPTIONS_ASSET_ID moved to '$CAPTIONS_STATUS' with caption-test-worker still stopped — this is the exact false pass §4.2 point 3 rules out (a seeded/static state, not real observed isolation)"
log "PASS: video independently reached 'ready' while captions stayed 'processing' with the caption worker stopped — this is the temporal acceptance proof"

log "starting caption-test-worker"
_compose up -d --wait caption-test-worker

log "releasing attempt $ATTEMPT_ID through the SAME Redis connection/keys DeterministicCaptionTranscriber itself uses (App\\Services\\Captions\\DeterministicCaptionTranscriber's docblock) — going through the app's own Redis facade rather than a raw redis-cli call against a guessed key prefix, since REDIS_CLIENT=predis and Laravel's own key-prefixing (config/database.php's redis.options.prefix) is otherwise invisible from outside the app container"
_compose exec -T app php artisan tinker --execute="
    Illuminate\Support\Facades\Redis::connection()->setex('caption-test-worker:release:${ATTEMPT_ID}', 3600, '1');
    echo 'released'.PHP_EOL;
" >/dev/null

log "polling up to ${CAPTIONS_READY_TIMEOUT}s for captions to reach 'ready' now that the deterministic worker is running and released"
DEADLINE=$((SECONDS + CAPTIONS_READY_TIMEOUT))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  CAPTIONS_STATUS="$(query_asset_status "$CAPTIONS_ASSET_ID")"
  [ "$CAPTIONS_STATUS" = "ready" ] && break
  if [ "$CAPTIONS_STATUS" = "failed" ]; then
    FAILURE="$(_compose exec -T app php artisan tinker --execute="
        \$a = App\Models\SpeechAsset::find(${CAPTIONS_ASSET_ID});
        echo (\$a->failure_code ?? '').'|'.(\$a->failure_detail ?? '').PHP_EOL;
    " | tr -d '\r' | tail -n1)"
    fail "captions asset $CAPTIONS_ASSET_ID failed instead of reaching 'ready' after release: $FAILURE"
  fi
  sleep "$POLL_INTERVAL"
done

[ "$CAPTIONS_STATUS" = "ready" ] || fail "captions asset $CAPTIONS_ASSET_ID did not reach 'ready' within ${CAPTIONS_READY_TIMEOUT}s of starting/releasing caption-test-worker (last observed status: '${CAPTIONS_STATUS:-unknown}')"

log "PASS: captions reached 'ready' once caption-test-worker was started and the held attempt released"

log "verify-caption-worker-isolation: PASS"
# The `cleanup` trap above now stops caption-test-worker again and removes
# the smoke speech/assets/media objects — §7's "drains the held captions
# job ... so no queued work leaks into later tests."
