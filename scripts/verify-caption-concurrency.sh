#!/usr/bin/env bash
#
# STEP-09-VERIFICATION-PLAN.md §7 point 7: "runs verify-caption-
# concurrency.sh against PostgreSQL/Valkey with two normal workers plus
# controlled E2E caption workers, covering forced re-derive overlap,
# concurrent enable/upload/retry, and attempt A -> disable -> re-enable B
# before returning to one default worker and no caption worker."
#
# HONEST GAP UP FRONT (found while building this script, not asserted by
# the task brief that commissioned it): §4.1's "Projection convergence
# token" paragraph — a content_revision/caption_revision column pair, a
# revision argument on RederiveTranscript, and removing that job's
# WithoutOverlapping middleware plus its redis-long/captions routing — is
# NOT implemented on this branch. `grep -n content_revision
# api/app/**` turns up nothing but a comment in
# WhisperSmokeVerifyCommand.php admitting the same thing. RederiveTranscript
# (api/app/Jobs/RederiveTranscript.php) still sets `$connection =
# 'redis-long'`, `$queue = 'captions'`, and still carries
# `WithoutOverlapping('rederive-{id}')->releaseAfter(0)`. That mutex
# actually serializes every execution for one asset, so the specific
# stale-read-then-late-write race the frozen contract worries about cannot
# be forced from outside without a code-level delay hook this branch does
# not have. Scenario 1 below therefore proves the weaker, still real
# property that IS observable through this queue's actual behavior: rapid
# consecutive edits, drained by two concurrent workers on the queue this
# job actually uses, always converge to the LAST edit's canonical VTT and
# derived transcript body (RederiveTranscript re-reads current storage at
# execution time rather than a payload snapshot, which is what makes this
# hold even without a revision column). It does NOT prove revision-based
# compare-and-set, because that mechanism does not exist yet. Fix the gap
# by landing §4.1's revision work, then tighten this scenario to assert
# the revision fields directly.
#
# "two normal workers" (§7 point 7's own phrase) is compose.yaml's
# `queue-worker` service in the plan's prose, but that service only ever
# drains `--queue=default`, which none of GenerateCaptions/
# RederiveTranscript/caption-test-worker use — every job this script
# exercises is on `redis-long`/`captions`. This script therefore scales
# `caption-test-worker` (compose.e2e.yaml, the actual consumer of that
# queue in the E2E stack) to 2 replicas where real concurrent consumption
# is needed, and never touches `queue-worker`'s replica count.
#
# CONCURRENCY MECHANISM CHOICE (scenarios 2 and 3): parallel `artisan
# tinker --execute` processes backgrounded from this script, calling
# App\Services\Captions\EnsureCaptionJob's public methods directly
# in-process, NOT parallel HTTP requests with CSRF/session cookies. Chosen
# over the HTTP route because EnsureCaptionJob's own row locks
# (lockForUpdate on `speeches` then `speech_assets`) are exactly what this
# script needs to prove holds under concurrency, and calling the service
# directly proves that lock genuinely serializes concurrent callers without
# also having to stand up and debug a second real authentication flow in
# bash — CaptionController::updateSettings/retry are both thin HTTP
# boundaries (`$this->authorize(...)` then one EnsureCaptionJob call) with
# no additional concurrency-relevant logic of their own, so this is a
# genuine proof of the seam that matters, not a shortcut around it.
#
# §4.2 point 2 ("two workers plus rapid consecutive edits and a forced
# overlap derive the newest revision") and point 6 ("off-switch:
# concurrent enable/upload/retry, disable during a running transcriber,
# database uniqueness") are Pest tests already covering the same state
# table in-process against SQLite — this script is the compose-level,
# real-Postgres/real-Valkey, real-multi-process proof that the same
# invariants hold when actual OS processes race each other, which SQLite's
# single-writer semantics can never exercise.
#
# Requires the E2E stack already up under APP_ENV=e2e
# (`./scripts/e2e-stack.sh up`) — this script does not start/stop the
# stack itself, mirroring verify-caption-recovery-scheduler.sh. It DOES
# manage caption-test-worker's running state (start it, scale it to 2 for
# scenarios that need two concurrent caption-queue consumers, stop it
# again before returning) — never the whole stack.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT="speechcoach-e2e"
RUN_ID="$(date +%s)-$$"

_compose() {
  docker compose -p "$PROJECT" -f compose.yaml -f compose.e2e.yaml "$@"
}

log() { echo "==> $*" >&2; }
fail() { echo "!!! $*" >&2; exit 1; }

_tinker() {
  # Centralized so every one of this script's ~20 call sites gets the same
  # protection: under `set -e`, a bare `X="$(_tinker ...)"` would otherwise
  # die on the very command substitution that failed, before any caller-side
  # validation/`fail` message ever runs — silently swallowing the real PHP/
  # Docker error (exactly the failure mode found and fixed in
  # verify-caption-worker-isolation.sh's SEED_OUTPUT capture). Fail loudly
  # HERE, with stderr merged into the captured output, instead of letting
  # every call site die with zero diagnostic text.
  local out rc
  set +e
  out="$(_compose exec -T app php artisan tinker --execute="$1" 2>&1 | tr -d '\r')"
  rc=$?
  set -e
  [ "$rc" -eq 0 ] || fail "tinker command exited $rc:
$out"
  echo "$out"
}

# cleanup() below deliberately tolerates a failed removal (log + continue,
# never abort the rest of cleanup) — _tinker()'s own fail()-and-exit
# behavior above is wrong there, so cleanup uses this non-failing sibling
# instead. Same stderr-merge/pipefail-safe capture, no `fail` call.
_tinker_lenient() {
  local out rc
  set +e
  out="$(_compose exec -T app php artisan tinker --execute="$1" 2>&1 | tr -d '\r')"
  rc=$?
  set -e
  echo "$out"
  return "$rc"
}

# Every speech id this script creates, tracked so the cleanup trap can
# remove exactly these rows and nothing else, same discipline as
# verify-caption-recovery-scheduler.sh's single smoke row.
CREATED_SPEECH_IDS=()

cleanup() {
  local rc=$?
  log "cleanup: removing $((${#CREATED_SPEECH_IDS[@]})) speech(es) created by this run"
  for id in "${CREATED_SPEECH_IDS[@]:-}"; do
    [ -z "$id" ] && continue
    _tinker_lenient "
      \$s = App\Models\Speech::withTrashed()->find(${id});
      if (\$s !== null) {
        \$s->assets()->delete();
        \App\Models\SpeechTranscript::where('speech_id', ${id})->delete();
        \$s->forceDelete();
      }
      echo 'cleaned'.PHP_EOL;
    " >/dev/null 2>&1 || log "cleanup: failed to remove speech ${id} — inspect by hand"
  done

  log "cleanup: stopping caption-test-worker, restoring queue-worker's single default replica"
  # This script never scales queue-worker itself (RederiveTranscript/
  # GenerateCaptions both route to redis-long/captions, which queue-worker
  # never drains — see the gap note at the top of this file) — the
  # restore below is defensive only, in case a prior/failed run left it
  # scaled from something else, per the plan's "returning to ... one
  # default worker and no caption worker" closing requirement.
  _compose stop caption-test-worker >/dev/null 2>&1 || true
  _compose up -d --scale caption-test-worker=0 caption-test-worker >/dev/null 2>&1 || true
  _compose up -d --scale queue-worker=1 queue-worker >/dev/null 2>&1 || true

  if [ "$rc" -ne 0 ]; then
    log "verify-caption-concurrency: FAILED (exit $rc)"
  fi
  exit "$rc"
}
trap cleanup EXIT

sha256_of() {
  printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
}

# ===========================================================================
# Scenario 1 — forced re-derive overlap (§4.2 point 2, adapted per the gap
# note above): two rapid consecutive edits, drained by two real concurrent
# workers on the queue RederiveTranscript actually uses today
# (redis-long/captions — the same queue GenerateCaptions/caption-test-
# worker use, not redis/default; see the gap note). Asserts the FINAL
# stored VTT and derived transcript body match the LAST edit, not the
# first — proving eventual convergence under concurrent draining, which is
# what's actually implemented, while explicitly not claiming the stronger
# revision-guard proof the frozen contract calls for.
# ===========================================================================
scenario_rederive_overlap() {
  log "[1/3] forced re-derive overlap"

  local title="concurrency-rederive-${RUN_ID}"
  local edit1_vtt edit2_vtt edit1_b64 edit2_b64
  edit1_vtt=$'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nFirst edit alpha.\n'
  edit2_vtt=$'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nSecond edit beta, the one that must win.\n'
  # base64 round-trip, not bash's ${var@Q}: the VTT strings contain real
  # newlines, and @Q's ANSI-C ($'...') quoting is shell-reuse syntax, not
  # valid PHP — embedding it directly in the tinker --execute payload
  # below would corrupt the PHP source. base64 has no characters that are
  # special to either bash double-quoting or PHP single-quote literals.
  edit1_b64="$(printf '%s' "$edit1_vtt" | base64 | tr -d '\n')"
  edit2_b64="$(printf '%s' "$edit2_vtt" | base64 | tr -d '\n')"

  log "seeding a ready captions asset + transcript"
  local speech_id asset_id
  speech_id="$(_tinker "
    \$speech = App\Models\Speech::factory()->create(['title' => '${title}']);
    \$asset = App\Models\SpeechAsset::factory()->for(\$speech)->captions()->ready()->create();
    \$vtt = base64_decode('${edit1_b64}');
    Storage::disk(\$asset->disk)->put(\$asset->path, \$vtt);
    \$cues = App\Services\Captions\Vtt::parse(\$vtt);
    \$derived = (new App\Services\Captions\TranscriptDeriver)->derive(\$cues);
    App\Models\SpeechTranscript::create([...\$derived, 'speech_id' => \$speech->id, 'language' => 'en', 'model' => 'e2e-fixture', 'source' => 'whisper']);
    echo \$speech->id.PHP_EOL;
  " | tail -n1)"
  [ -n "$speech_id" ] || fail "failed to seed scenario-1 speech"
  CREATED_SPEECH_IDS+=("$speech_id")
  log "scenario-1 speech id: $speech_id"

  log "scaling caption-test-worker to 2 replicas so two real processes drain redis-long/captions concurrently"
  _compose up -d --scale caption-test-worker=2 caption-test-worker >/dev/null

  log "firing two rapid consecutive owner edits (edit1 then edit2) — each PUT's real code path: CaptionService::update writes VTT synchronously, then dispatches RederiveTranscript"
  _tinker "
    \$speech = App\Models\Speech::find(${speech_id});
    (new App\Services\Captions\CaptionService)->update(\$speech, base64_decode('${edit1_b64}'));
  " >/dev/null
  _tinker "
    \$speech = App\Models\Speech::find(${speech_id});
    (new App\Services\Captions\CaptionService)->update(\$speech, base64_decode('${edit2_b64}'));
  " >/dev/null

  log "waiting for the redis-long/captions queue to drain both RederiveTranscript jobs"
  local end=$((SECONDS + 60))
  local depth="unknown"
  while [ "$SECONDS" -lt "$end" ]; do
    depth="$(_compose exec -T app php artisan tinker --execute="echo Illuminate\Support\Facades\Redis::connection('default')->llen('queues:captions').PHP_EOL;" | tr -d '\r' | tail -n1)"
    if [ "$depth" = "0" ]; then
      break
    fi
    sleep 1
  done
  [ "$depth" = "0" ] || fail "captions queue did not drain within 60s (last depth observed: $depth)"

  log "asserting the FINAL stored VTT and derived transcript body match the LAST edit (edit2), not edit1"
  local expected_hash actual_hash body_ok
  expected_hash="$(sha256_of "$edit2_vtt")"
  actual_hash="$(_tinker "
    \$asset = App\Models\SpeechAsset::where('speech_id', ${speech_id})->where('kind', 'captions')->first();
    echo hash('sha256', Storage::disk(\$asset->disk)->get(\$asset->path)).PHP_EOL;
  " | tail -n1)"
  [ "$actual_hash" = "$expected_hash" ] || fail "final canonical VTT hash ($actual_hash) does not match edit2's hash ($expected_hash) — last edit did not win"

  body_ok="$(_tinker "
    \$t = App\Models\SpeechTranscript::where('speech_id', ${speech_id})->first();
    echo (\$t !== null && str_contains(\$t->body, 'Second edit beta, the one that must win')) ? 'yes' : 'no';
    echo PHP_EOL;
  " | tail -n1)"
  [ "$body_ok" = "yes" ] || fail "derived transcript body does not reflect edit2 — a stale re-derive clobbered the newest edit"

  log "scaling caption-test-worker back to 0 before the next scenario"
  _compose up -d --scale caption-test-worker=0 caption-test-worker >/dev/null

  log "[1/3] PASS: last edit (edit2) is authoritative in both canonical VTT and derived transcript after concurrent draining"
}

# ===========================================================================
# Scenario 2 — concurrent enable/upload/retry (§4.1's state table, §4.2
# point 6). Fires several EnsureCaptionJob calls at once in-process
# (enable + retryAutomatic) against the SAME speech and asserts the DB
# never ends up with more than one speech_assets row of kind='captions'
# for that speech, then drains whichever attempt ends up authoritative to
# `ready` and confirms the partial unique index exists as the documented
# last-resort backstop (not exercised as a rescue here — the point of this
# scenario is that the service-level lock means it's never needed).
# ===========================================================================
scenario_concurrent_enable_retry() {
  log "[2/3] concurrent enable/upload/retry"

  local title="concurrency-enable-retry-${RUN_ID}"
  log "seeding a speech with a ready source and an existing failed captions row (valid precondition for both enable() and retryAutomatic())"
  local speech_id asset_id
  read -r speech_id asset_id <<<"$(_tinker "
    \$speech = App\Models\Speech::factory()->create(['title' => '${title}', 'captions_enabled' => true]);
    App\Models\SpeechAsset::factory()->for(\$speech)->ready()->create();
    \$asset = App\Models\SpeechAsset::factory()->for(\$speech)->captions()->failed()->create();
    echo \$speech->id.' '.\$asset->id.PHP_EOL;
  " | tail -n1)"
  [ -n "$speech_id" ] && [ -n "$asset_id" ] || fail "failed to seed scenario-2 speech/asset"
  CREATED_SPEECH_IDS+=("$speech_id")
  log "scenario-2 speech id: $speech_id, captions asset id: $asset_id"

  log "starting caption-test-worker (single replica — only the eventual winning attempt does real work)"
  _compose up -d --scale caption-test-worker=1 caption-test-worker >/dev/null

  log "firing 3x enable() + 2x retryAutomatic() concurrently as backgrounded real OS processes"
  local pids=()
  local i
  for i in 1 2 3; do
    _compose exec -T app php artisan tinker --execute="
      \$speech = App\Models\Speech::find(${speech_id});
      app(App\Services\Captions\EnsureCaptionJob::class)->enable(\$speech);
      echo 'enable-${i}-done'.PHP_EOL;
    " >/dev/null 2>&1 &
    pids+=("$!")
  done
  for i in 1 2; do
    _compose exec -T app php artisan tinker --execute="
      \$speech = App\Models\Speech::find(${speech_id});
      \$asset = App\Models\SpeechAsset::find(${asset_id});
      try {
        app(App\Services\Captions\EnsureCaptionJob::class)->retryAutomatic(\$speech, \$asset);
      } catch (\Throwable \$e) {
        // A losing retryAutomatic racing a losing/winning enable() is an
        // acceptable outcome here (real HTTP callers already gate this on
        // 'asset is currently failed' before calling in; a stale read
        // under real concurrency can legitimately throw or no-op) — the
        // invariant this scenario proves is row-count, not that every
        // concurrent caller succeeds.
      }
      echo 'retry-${i}-done'.PHP_EOL;
    " >/dev/null 2>&1 &
    pids+=("$!")
  done

  local pid
  for pid in "${pids[@]}"; do
    wait "$pid" || true
  done
  log "all 5 concurrent calls returned"

  log "asserting exactly one speech_assets row of kind='captions' exists for this speech"
  local row_count
  row_count="$(_tinker "
    echo App\Models\SpeechAsset::where('speech_id', ${speech_id})->where('kind', 'captions')->count().PHP_EOL;
  " | tail -n1)"
  [ "$row_count" = "1" ] || fail "expected exactly 1 captions row after concurrent enable/retry, found $row_count — EnsureCaptionJob's row lock did not serialize correctly"

  log "asserting the partial unique index uq_assets_captions_one_per_speech exists (the documented last-resort backstop, not exercised as a rescue by this scenario — verify-postgres-caption-schema.sh is the authoritative catalog check)"
  local index_exists
  index_exists="$(_tinker "
    \$row = DB::selectOne(\"SELECT 1 AS present FROM pg_indexes WHERE indexname = 'uq_assets_captions_one_per_speech'\");
    echo (\$row->present ?? 0).PHP_EOL;
  " | tail -n1)"
  [ "$index_exists" = "1" ] || fail "uq_assets_captions_one_per_speech index not found in the live Postgres catalog"

  log "resolving whichever attempt is currently authoritative and draining it to ready"
  local attempt_id
  attempt_id="$(_tinker "
    echo (App\Models\SpeechAsset::find(${asset_id})->caption_attempt_id ?? '').PHP_EOL;
  " | tail -n1)"
  [ -n "$attempt_id" ] || fail "no current caption_attempt_id found on the surviving captions row"
  log "authoritative attempt id: $attempt_id"

  wait_for_status_held "$attempt_id" 30
  release_attempt "$attempt_id"
  wait_for_status "$attempt_id" ready 30

  local final_status
  final_status="$(_tinker "echo App\Models\SpeechAsset::find(${asset_id})->status.PHP_EOL;" | tail -n1)"
  [ "$final_status" = "ready" ] || fail "captions asset did not reach ready after releasing the authoritative attempt (status: $final_status)"

  _compose up -d --scale caption-test-worker=0 caption-test-worker >/dev/null

  log "[2/3] PASS: exactly one captions row survived 5 concurrent enable/retry calls, and its authoritative attempt reached ready"
}

# ===========================================================================
# Scenario 3 — attempt A -> disable -> re-enable B (§4.1's closing
# paragraph: "old attempt A followed by disable/re-enable B ... B always
# remains authoritative"). Two caption-test-worker replicas so A can stay
# blocked mid-transcribe in one process while B is picked up and completed
# by the other — a single replica would leave B queued behind A's still-
# running process, which would prove nothing about A being unable to
# clobber B once B is done.
# ===========================================================================
scenario_attempt_disable_reenable() {
  log "[3/3] attempt A -> disable -> re-enable B"

  local title="concurrency-attempt-ab-${RUN_ID}"
  log "seeding a speech with a ready source, captions enabled"
  local speech_id
  speech_id="$(_tinker "
    \$speech = App\Models\Speech::factory()->create(['title' => '${title}', 'captions_enabled' => true]);
    App\Models\SpeechAsset::factory()->for(\$speech)->ready()->create();
    echo \$speech->id.PHP_EOL;
  " | tail -n1)"
  [ -n "$speech_id" ] || fail "failed to seed scenario-3 speech"
  CREATED_SPEECH_IDS+=("$speech_id")
  log "scenario-3 speech id: $speech_id"

  log "scaling caption-test-worker to 2 replicas (A stays blocked in one, B runs concurrently in the other)"
  _compose up -d --scale caption-test-worker=2 caption-test-worker >/dev/null

  log "starting attempt A via EnsureCaptionJob::enable() (ready source, no existing asset -> create + dispatch)"
  _tinker "
    \$speech = App\Models\Speech::find(${speech_id});
    app(App\Services\Captions\EnsureCaptionJob::class)->enable(\$speech);
  " >/dev/null

  local asset_id attempt_a
  asset_id="$(_tinker "echo App\Models\SpeechAsset::where('speech_id', ${speech_id})->where('kind', 'captions')->first()->id.PHP_EOL;" | tail -n1)"
  attempt_a="$(_tinker "echo App\Models\SpeechAsset::find(${asset_id})->caption_attempt_id.PHP_EOL;" | tail -n1)"
  [ -n "$asset_id" ] && [ -n "$attempt_a" ] || fail "attempt A did not get created/dispatched"
  log "attempt A: $attempt_a (asset $asset_id)"

  wait_for_status_held "$attempt_a" 30
  log "attempt A is held mid-transcribe — do NOT release it yet"

  log "disabling automatic captions — must invalidate A and move the row to failed/captions_disabled"
  _tinker "
    \$speech = App\Models\Speech::find(${speech_id});
    app(App\Services\Captions\EnsureCaptionJob::class)->disable(\$speech);
  " >/dev/null

  local status_after_disable token_after_disable
  status_after_disable="$(_tinker "echo App\Models\SpeechAsset::find(${asset_id})->status.PHP_EOL;" | tail -n1)"
  token_after_disable="$(_tinker "echo (App\Models\SpeechAsset::find(${asset_id})->caption_attempt_id ?? '').PHP_EOL;" | tail -n1)"
  [ "$status_after_disable" = "failed" ] || fail "expected status=failed after disabling a processing captions asset, got '$status_after_disable'"
  [ -z "$token_after_disable" ] || fail "expected caption_attempt_id to be invalidated (null) after disable, got '$token_after_disable'"
  log "confirmed: row is failed/invalidated while A's worker process is still physically blocked in its held loop"

  log "re-enabling — must rotate a NEW attempt B and dispatch a new job"
  _tinker "
    \$speech = App\Models\Speech::find(${speech_id});
    app(App\Services\Captions\EnsureCaptionJob::class)->enable(\$speech);
  " >/dev/null

  local attempt_b status_after_reenable
  attempt_b="$(_tinker "echo App\Models\SpeechAsset::find(${asset_id})->caption_attempt_id.PHP_EOL;" | tail -n1)"
  status_after_reenable="$(_tinker "echo App\Models\SpeechAsset::find(${asset_id})->status.PHP_EOL;" | tail -n1)"
  [ -n "$attempt_b" ] && [ "$attempt_b" != "$attempt_a" ] || fail "re-enable did not rotate a fresh attempt id distinct from A ($attempt_a vs $attempt_b)"
  [ "$status_after_reenable" = "processing" ] || fail "expected status=processing after re-enable, got '$status_after_reenable'"
  log "attempt B: $attempt_b"

  wait_for_status_held "$attempt_b" 30
  log "attempt B is held mid-transcribe in the second replica, while A's process is still blocked in its own held loop"

  log "releasing B first — must reach ready"
  release_attempt "$attempt_b"
  wait_for_status "$attempt_b" ready 30

  local status_after_b token_after_b
  status_after_b="$(_tinker "echo App\Models\SpeechAsset::find(${asset_id})->status.PHP_EOL;" | tail -n1)"
  token_after_b="$(_tinker "echo App\Models\SpeechAsset::find(${asset_id})->caption_attempt_id.PHP_EOL;" | tail -n1)"
  [ "$status_after_b" = "ready" ] || fail "expected status=ready after releasing B, got '$status_after_b'"
  [ "$token_after_b" = "$attempt_b" ] || fail "expected caption_attempt_id=$attempt_b after B's write, got '$token_after_b'"
  log "confirmed: B published ready and is the current attempt on the row"

  log "NOW releasing A's (stale) hold too — its compare-and-set write must be rejected and must NOT clobber B's ready result"
  release_attempt "$attempt_a"
  wait_for_status "$attempt_a" superseded 30

  local final_status final_token
  final_status="$(_tinker "echo App\Models\SpeechAsset::find(${asset_id})->status.PHP_EOL;" | tail -n1)"
  final_token="$(_tinker "echo App\Models\SpeechAsset::find(${asset_id})->caption_attempt_id.PHP_EOL;" | tail -n1)"
  [ "$final_status" = "ready" ] || fail "A's late write clobbered the row: expected status=ready (B's result), got '$final_status'"
  [ "$final_token" = "$attempt_b" ] || fail "A's late write clobbered the attempt token: expected $attempt_b (B), got '$final_token'"

  _compose up -d --scale caption-test-worker=0 caption-test-worker >/dev/null

  log "[3/3] PASS: A's stale release was rejected by the compare-and-set (status=$final_status, attempt=$final_token) — B remained authoritative"
}

# ---------------------------------------------------------------------------
# Shared helpers driving the DeterministicCaptionTranscriber Redis protocol
# (api/app/Services/Captions/DeterministicCaptionTranscriber.php's own
# docblock is the authoritative spec for these key names/semantics). These
# go through `artisan tinker`'s Redis facade — the SAME `default` Valkey
# connection the class itself uses — rather than raw `valkey-cli` in the
# valkey container, because config/database.php's `redis.options.prefix`
# (defaults to "laravel-database-", from APP_NAME) is applied automatically
# by the phpredis client for every Redis-facade call but NOT by a bare
# `valkey-cli GET`; hardcoding that prefix here would silently break the
# moment APP_NAME changes.
# ---------------------------------------------------------------------------
wait_for_status_held() {
  local attempt_id="$1" deadline="$2"
  local end=$((SECONDS + deadline))
  local status="unknown"
  while [ "$SECONDS" -lt "$end" ]; do
    status="$(_tinker "echo (Illuminate\Support\Facades\Redis::connection()->get('caption-test-worker:status:${attempt_id}') ?? '').PHP_EOL;" | tail -n1)"
    if [ "$status" = "held" ] || [ "$status" = "processing" ] || [ "$status" = "ready" ]; then
      return 0
    fi
    sleep 1
  done
  fail "attempt ${attempt_id} never reached 'held' within ${deadline}s (last observed: '${status}') — is caption-test-worker actually running/scaled up?"
}

wait_for_status() {
  local attempt_id="$1" want="$2" deadline="$3"
  local end=$((SECONDS + deadline))
  local status="unknown"
  while [ "$SECONDS" -lt "$end" ]; do
    status="$(_tinker "echo (Illuminate\Support\Facades\Redis::connection()->get('caption-test-worker:status:${attempt_id}') ?? '').PHP_EOL;" | tail -n1)"
    if [ "$status" = "$want" ]; then
      return 0
    fi
    sleep 1
  done
  fail "attempt ${attempt_id} never reached status '${want}' within ${deadline}s (last observed: '${status}')"
}

release_attempt() {
  local attempt_id="$1"
  _tinker "Illuminate\Support\Facades\Redis::connection()->setex('caption-test-worker:release:${attempt_id}', 3600, '1'); echo 'released'.PHP_EOL;" >/dev/null
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
log "verify-caption-concurrency: starting against project '$PROJECT'"

scenario_rederive_overlap
scenario_concurrent_enable_retry
scenario_attempt_disable_reenable

log "verify-caption-concurrency: PASS (all 3 scenarios) — restoring one default queue-worker, no caption worker"
