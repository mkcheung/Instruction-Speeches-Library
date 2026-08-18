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
# Exceeds config('captions.queue_wait_seconds')'s production default
# (900s) so the very next scheduler tick (every minute under APP_ENV=e2e)
# reconciles it — no threshold override needed, only an already-stale
# `caption_queued_at`.
STALE_SECONDS=1000

_compose() {
  docker compose -p "$PROJECT" -f compose.yaml -f compose.e2e.yaml "$@"
}

log() { echo "==> $*" >&2; }
fail() { echo "!!! $*" >&2; exit 1; }

log "seeding scheduler-smoke row: $SMOKE_TITLE"
_compose exec -T app php artisan tinker --execute="
    \$speech = App\Models\Speech::factory()->create(['title' => '${SMOKE_TITLE}']);
    \$asset = App\Models\SpeechAsset::factory()->for(\$speech)->captions()->create([
        'status' => 'processing',
        'caption_attempt_id' => (string) Illuminate\Support\Str::uuid(),
        'caption_queued_at' => now()->subSeconds(${STALE_SECONDS}),
        'caption_started_at' => null,
        'caption_heartbeat_at' => null,
    ]);
    echo \$asset->id.PHP_EOL;
" | tr -d '\r' | tail -n1 > /tmp/verify-caption-recovery-scheduler.assetid

ASSET_ID="$(cat /tmp/verify-caption-recovery-scheduler.assetid)"
rm -f /tmp/verify-caption-recovery-scheduler.assetid
[ -n "$ASSET_ID" ] && [ "$ASSET_ID" -gt 0 ] 2>/dev/null || fail "failed to seed the scheduler-smoke row (no asset id returned)"
log "smoke asset id: $ASSET_ID"

log "waiting up to 90s for the actually-running scheduler service to fail it"
DEADLINE=$((SECONDS + 90))
STATUS=""
FAILURE_CODE=""
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  RESULT="$(_compose exec -T app php artisan tinker --execute="
      \$a = App\Models\SpeechAsset::find(${ASSET_ID});
      echo (\$a->status ?? 'MISSING').'|'.(\$a->failure_code ?? '').PHP_EOL;
  " | tr -d '\r' | tail -n1)"
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

log "stopping the scheduler service"
_compose stop scheduler

log "removing only the scheduler-smoke row"
_compose exec -T app php artisan tinker --execute="
    \$a = App\Models\SpeechAsset::find(${ASSET_ID});
    if (\$a !== null) {
        \$speechId = \$a->speech_id;
        \$a->delete();
        App\Models\Speech::destroy(\$speechId);
    }
    echo 'cleaned'.PHP_EOL;
" >/dev/null

log "re-seeding E2ECaptionsSeeder so the browser processing fixture has fresh liveness clocks"
_compose exec -T app php artisan db:seed --class=E2ECaptionsSeeder --force

log "asserting the scheduler service is stopped"
STATE="$(_compose ps --format '{{.State}}' scheduler || true)"
if [ "$STATE" = "running" ]; then
  fail "scheduler service is still running after 'stop' — expected it to remain stopped"
fi

log "verify-caption-recovery-scheduler: PASS"
