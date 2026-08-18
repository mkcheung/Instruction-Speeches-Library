#!/usr/bin/env bash
#
# STEP-09-VERIFICATION-PLAN.md §7: "add a production Compose scheduler
# service running Laravel's scheduler with a restart policy. CI starts that
# service under APP_ENV=e2e, where the SAME media:reconcile schedule is
# every minute, seeds a uniquely named scheduler-smoke row outside all
# browser fixture IDs, and requires its safe failed transition within 90
# seconds; direct media:reconcile invocation does not satisfy this wiring
# proof."
#
# Direct invocation would only prove App\Console\Commands\MediaReconcileCommand
# itself works (already covered by Pest) — this proves the SEPARATE
# `scheduler` compose service (routes/console.php's registered schedule +
# `php artisan schedule:work`, actually running as its own long-lived
# process) is what triggers the transition, with nobody calling
# `artisan media:reconcile` by hand.
#
# Requires the E2E stack already up under APP_ENV=e2e (`./scripts/e2e-stack.sh
# up`) — this script does not start/stop the stack itself, only the
# `scheduler` service within it, and only ever touches the ONE smoke row it
# creates.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT="speechcoach-e2e"
# Distinctive, timestamped title — "outside all browser fixture IDs"
# (E2ECaptionsSeeder's fixed 9401-9409/9501+ range) so this can never
# collide with or be mistaken for a Playwright fixture row.
SMOKE_TITLE="scheduler-smoke-$(date +%s)-$$"
# Age the row beyond the runtime's configured queue-wait threshold so the
# very next scheduler tick (every minute under APP_ENV=e2e) reconciles it.
# The fixed grace keeps this proof valid if the production default changes;
# no test-only threshold override is involved.
STALE_GRACE_SECONDS=100

_compose() {
  docker compose -p "$PROJECT" -f compose.yaml -f compose.e2e.yaml "$@"
}

log() { echo "==> $*" >&2; }
fail() { echo "!!! $*" >&2; exit 1; }

_tinker() {
  # A failing command inside X="$(...)" would otherwise trip this script's
  # `set -e` before the caller can print the PHP/Docker error. Merge stderr,
  # capture the pipeline status under `pipefail`, then fail with the complete
  # diagnostic instead of leaving CI with only "exit code 1".
  local out rc
  set +e
  out="$(_compose exec -T app php artisan tinker --execute="$1" 2>&1 | tr -d '\r')"
  rc=$?
  set -e
  [ "$rc" -eq 0 ] || fail "tinker command exited $rc:
$out"
  printf '%s\n' "$out"
}

_tinker_lenient() {
  # Cleanup must preserve the original exit status, so it reports rather
  # than aborting when the stack itself is already unavailable.
  local out rc
  set +e
  out="$(_compose exec -T app php artisan tinker --execute="$1" 2>&1 | tr -d '\r')"
  rc=$?
  printf '%s\n' "$out"
  return "$rc"
}

# The scheduler must be stopped and the uniquely titled smoke speech removed
# on every exit path, not only after a passing assertion. Re-seeding also
# restores the browser suite's processing fixture with fresh liveness clocks
# if a scheduler tick touched it while this proof was running.
cleanup() {
  local rc=$?
  local cleanup_output state ps_rc
  set +e

  log "cleanup: stopping the scheduler service"
  if ! _compose stop scheduler >/dev/null 2>&1; then
    log "cleanup: failed to stop scheduler"
    rc=1
  fi

  log "cleanup: removing only the scheduler-smoke speech"
  cleanup_output="$(_tinker_lenient "
      \$speeches = App\Models\Speech::withTrashed()->where('title', '${SMOKE_TITLE}')->get();
      foreach (\$speeches as \$speech) {
          \$speech->forceDelete();
      }
      echo 'cleaned '.\$speeches->count().PHP_EOL;
  ")"
  if [ $? -ne 0 ]; then
    log "cleanup: failed to remove scheduler-smoke speech:
$cleanup_output"
    rc=1
  fi

  log "cleanup: re-seeding E2ECaptionsSeeder with fresh liveness clocks"
  if ! _compose exec -T app php artisan db:seed --class=E2ECaptionsSeeder --force >/dev/null; then
    log "cleanup: failed to re-seed E2ECaptionsSeeder"
    rc=1
  fi

  log "cleanup: asserting the scheduler service is stopped"
  state="$(_compose ps --format '{{.State}}' scheduler 2>&1)"
  ps_rc=$?
  if [ "$ps_rc" -ne 0 ]; then
    log "cleanup: could not inspect scheduler state:
$state"
    rc=1
  elif [ "$state" = "running" ]; then
    log "cleanup: scheduler service is still running after 'stop'"
    rc=1
  fi

  if [ "$rc" -eq 0 ]; then
    log "verify-caption-recovery-scheduler: PASS"
  else
    log "verify-caption-recovery-scheduler: FAILED"
  fi

  trap - EXIT
  exit "$rc"
}
trap cleanup EXIT

log "seeding scheduler-smoke row: $SMOKE_TITLE"
SEED_OUTPUT="$(_tinker "
    // The runtime app image is built with Composer --no-dev, so Faker is
    // intentionally absent and model factories cannot be used here. Reuse
    // the guaranteed E2E member and provide every material asset field
    // explicitly, matching the production-safe E2E seeders.
    \$owner = App\Models\User::findOrFail(Database\Seeders\E2ESeeder::MEMBER_ID);
    \$speech = App\Models\Speech::create([
        'user_id' => \$owner->id,
        'title' => '${SMOKE_TITLE}',
    ]);
    \$asset = \$speech->assets()->create([
        'kind' => 'captions',
        'format' => 'vtt',
        'disk' => 'media',
        'path' => 'speeches/'.\$speech->ulid.'/captions.vtt',
        'status' => 'processing',
        'is_primary' => false,
        'caption_attempt_id' => (string) Illuminate\Support\Str::uuid(),
        'caption_queued_at' => now()->subSeconds(((int) config('captions.queue_wait_seconds')) + ${STALE_GRACE_SECONDS}),
        'caption_started_at' => null,
        'caption_heartbeat_at' => null,
    ]);
    echo \$speech->id.'|'.\$asset->id.PHP_EOL;
")"
RESULT_LINE="$(printf '%s\n' "$SEED_OUTPUT" | tail -n1)"
SPEECH_ID="${RESULT_LINE%%|*}"
ASSET_ID="${RESULT_LINE##*|}"
[ -n "$SPEECH_ID" ] && [ "$SPEECH_ID" -gt 0 ] 2>/dev/null || fail "failed to seed the scheduler-smoke speech (no speech id returned):
$SEED_OUTPUT"
[ -n "$ASSET_ID" ] && [ "$ASSET_ID" -gt 0 ] 2>/dev/null || fail "failed to seed the scheduler-smoke asset (no asset id returned):
$SEED_OUTPUT"
log "smoke speech id: $SPEECH_ID"
log "smoke asset id: $ASSET_ID"

log "waiting up to 90s for the actually-running scheduler service to fail it"
DEADLINE=$((SECONDS + 90))
STATUS=""
FAILURE_CODE=""
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  QUERY_OUTPUT="$(_tinker "
      \$a = App\Models\SpeechAsset::find(${ASSET_ID});
      echo (\$a->status ?? 'MISSING').'|'.(\$a->failure_code ?? '').PHP_EOL;
  ")"
  RESULT="$(printf '%s\n' "$QUERY_OUTPUT" | tail -n1)"
  STATUS="${RESULT%%|*}"
  FAILURE_CODE="${RESULT##*|}"

  if [ "$STATUS" = "failed" ]; then
    break
  fi

  sleep 3
done

if [ "$STATUS" != "failed" ]; then
  fail "scheduler-smoke row did not reach 'failed' within 90s (last observed status: '${STATUS:-unknown}') — the scheduler service may not be running/scheduled every minute under APP_ENV=e2e"
fi

if [ "$FAILURE_CODE" != "caption_queue_timeout" ]; then
  fail "scheduler-smoke row failed with unexpected failure_code '${FAILURE_CODE}', expected 'caption_queue_timeout'"
fi

log "PASS: the running scheduler service reconciled the stale row within 90s (failure_code=caption_queue_timeout)"
