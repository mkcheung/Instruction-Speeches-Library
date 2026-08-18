#!/usr/bin/env bash
#
# STEP-09 verification plan §6.4 "Isolated smoke harness":
#
#   "Add one `scripts/whisper-smoke-stack.sh` wrapper with a dedicated
#   Compose project/network and disposable PostgreSQL/SeaweedFS/Valkey
#   state. Every build, initializer, adapter, runtime, and queued-smoke
#   command goes through it; no bare `docker compose` may accidentally
#   consume the developer stack or model volume. The `whisper-smoke`
#   service explicitly mounts this project's verified model volume
#   READ-ONLY into `whisper-smoke`... A scoped trap tears down only this
#   project while retaining the host artifacts."
#
# Modeled on scripts/e2e-stack.sh's own conventions (read that script
# first if this one is unclear) — same `_compose()` seam, same
# port-guard-and-fail-loud pattern where relevant, same scoped-teardown
# trap shape. Deliberately a SEPARATE project/network from both the dev
# stack (`speechcoach-dev`) and the E2E stack (`speechcoach-e2e`):
# compose.whisper-smoke.yaml's only overrides are the network name and
# clearing `postgres`/`seaweedfs`'s published host ports (see that file's
# own comment for why a plain `ports: []` override doesn't work).
#
# THE BIG IDEA, same as e2e-stack.sh: every command below runs against
# `-p "$PROJECT"` plus BOTH compose files together via `_compose()`. This
# script also never calls a bare `docker compose up` (which would start
# EVERY non-profiled service in compose.yaml, including `app`/`web`/
# `queue-worker`/`ffmpeg-worker`/`scheduler` — none of which this smoke
# stack needs) — every invocation below names its target service(s)
# explicitly instead.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT="speechcoach-whisper-smoke"
ARTIFACT_DIR="$ROOT_DIR/artifacts/whisper-smoke"

_compose() {
  docker compose -p "$PROJECT" -f compose.yaml -f compose.whisper-smoke.yaml "$@"
}

log() { echo "==> $*" >&2; }
fail() { echo "!!! $*" >&2; exit 1; }

# Guards against ever tearing down anything but this validated project —
# same shape as e2e-stack.sh's own cleanup trap.
STACK_STARTED=0
cleanup_on_failure() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ "$STACK_STARTED" -eq 1 ]; then
    log "command failed (exit $rc) — tearing down the '$PROJECT' project only (host artifacts under $ARTIFACT_DIR are retained)"
    _compose down -v || log "cleanup itself failed; inspect 'docker compose -p $PROJECT ps' by hand"
  fi
  return $rc
}

# ---------------------------------------------------------------------------
# prepare — nothing host-side is required for this stack (no TLS/hostnames,
# unlike e2e-stack.sh): just confirm docker/jq are available and the
# fixture/model.lock this harness depends on actually exist, so a later
# command fails with a clear message instead of a confusing docker error.
# ---------------------------------------------------------------------------
cmd_prepare() {
  command -v docker >/dev/null 2>&1 || fail "docker not found on PATH"
  command -v jq >/dev/null 2>&1 || fail "jq not found on PATH (used to read docker/whisper/model.lock)"

  [ -f "$ROOT_DIR/docker/whisper/model.lock" ] || fail "missing docker/whisper/model.lock"
  [ -f "$ROOT_DIR/api/tests/fixtures/whisper-smoke/spoken-fixture.m4a" ] || fail "missing api/tests/fixtures/whisper-smoke/spoken-fixture.m4a — see that directory's README for how to regenerate it"

  mkdir -p "$ARTIFACT_DIR"

  log "prepare complete"
}

# ---------------------------------------------------------------------------
# build — builds every image this harness uses: the real whisper-worker
# target (§6.1/§6.3) and the dev-tooling whisper-smoke target (§6.2). Both
# are built from the SAME Dockerfile, so this is one `docker compose build`
# call, not two separate `docker build`s.
# ---------------------------------------------------------------------------
cmd_build() {
  log "building whisper-worker + whisper-smoke images"
  _compose build whisper-worker whisper-smoke whisper-model-init
}

# ---------------------------------------------------------------------------
# model [--offline-idempotency] — populate THIS project's own `whisper-models`
# named volume (distinct from the dev/E2E stacks' volumes of the same name,
# since Compose namespaces named volumes per project) via the real
# `whisper-model-init` service, then optionally prove the offline
# idempotency contract docker/whisper/init-model.sh promises: a second,
# network-disabled invocation against an already-correct file must exit 0
# without touching the file's mtime or re-downloading anything.
# ---------------------------------------------------------------------------
cmd_model() {
  local offline_check=0
  if [ "${1:-}" = "--offline-idempotency" ]; then
    offline_check=1
  fi

  log "running whisper-model-init (online) against the '$PROJECT' project's whisper-models volume"
  _compose --profile whisper-model-init run --rm whisper-model-init

  if [ "$offline_check" -eq 0 ]; then
    return 0
  fi

  local filename
  filename="$(jq -r '.filename' "$ROOT_DIR/docker/whisper/model.lock")"

  # `docker compose run` has no `--network` override flag on this CLI
  # (verified directly: `docker compose run --help` lists none, and a
  # first attempt using one failed with "unknown flag: --network") — so
  # the offline half of this check drops to plain `docker run --network
  # none` against the SAME image tag and named volume Compose itself uses
  # (`<project>-whisper-model-init` / `<project>_whisper-models`, Compose's
  # own default naming for both), rather than compose's own `run`.
  local image="${PROJECT}-whisper-model-init"
  local volume="${PROJECT}_whisper-models"

  log "recording mtime before the offline re-run"
  local mtime_before
  mtime_before="$(docker run --rm --entrypoint sh -v "${volume}:/models" "$image" -c "stat -c %Y /models/${filename}" 2>/dev/null | tr -d '\r')"
  [ -n "$mtime_before" ] || fail "could not stat /models/${filename} after the online run — did whisper-model-init actually succeed?"

  log "re-running whisper-model-init with networking disabled (--network none) — must exit 0 with an UNCHANGED file, proving it never tried to re-download"
  docker run --rm --network none -v "${volume}:/models" \
    -e WHISPER_MODEL_DIR=/models -e WHISPER_MODEL_LOCK=/docker/whisper/model.lock \
    "$image" \
    || fail "offline re-run of whisper-model-init failed — it should have found the already-correct file and exited 0 without touching the network"

  local mtime_after
  mtime_after="$(docker run --rm --entrypoint sh -v "${volume}:/models" "$image" -c "stat -c %Y /models/${filename}" 2>/dev/null | tr -d '\r')"

  if [ "$mtime_before" != "$mtime_after" ]; then
    fail "offline idempotency check FAILED: /models/${filename} mtime changed ($mtime_before -> $mtime_after) — init-model.sh re-wrote a file that already matched its checksum"
  fi

  log "offline idempotency check PASSED: mtime unchanged ($mtime_before)"
}

# ---------------------------------------------------------------------------
# runtime — STEP-09 verification plan §6.1/§6.3 item 7: ldd + `whisper-cli
# --help` against the ACTUAL whisper-worker image, not only the
# dev-derived whisper-smoke target. Delegates to the existing
# scripts/verify-whisper-runtime.sh (already built and used elsewhere in
# this repo) rather than duplicating its `set -eu`, no-pipeline-masking
# ldd/help checks a second time.
# ---------------------------------------------------------------------------
cmd_runtime() {
  log "verifying the whisper-worker image's runtime linking + CLI (scripts/verify-whisper-runtime.sh)"
  WHISPER_WORKER_VERIFY_TAG="${PROJECT}-whisper-worker-runtime-check" "$ROOT_DIR/scripts/verify-whisper-runtime.sh"
}

# ---------------------------------------------------------------------------
# adapter — §6.2: runs RealWhisperAdapterSmokeTest inside the whisper-smoke
# container against the real whisper-cli binary + this project's own
# checksum-verified, READ-ONLY-mounted model volume. Uses SQLite +
# Storage::fake('media') internally (see that test's own docblock) — no
# Postgres/SeaweedFS/Valkey dependency for this command.
# ---------------------------------------------------------------------------
cmd_adapter() {
  local model_id
  model_id="$(jq -r '.model_id' "$ROOT_DIR/docker/whisper/model.lock")"

  log "running RealWhisperAdapterSmokeTest inside whisper-smoke (model_id=$model_id)"
  _compose --profile whisper-smoke run --rm \
    -e WHISPER_MODEL_NAME="$model_id" \
    whisper-smoke \
    php artisan test --filter=RealWhisperAdapterSmokeTest
}

# ---------------------------------------------------------------------------
# queued — §6.3: the final-worker sign-off. Brings up disposable
# Postgres/SeaweedFS/Valkey, migrates + initializes the media bucket, seeds
# a real source asset and dispatches a real GenerateCaptions job (via
# `captions:whisper-smoke-seed`, run inside whisper-smoke so `artisan` has
# dev deps + factories available), runs the job through the ACTUAL
# whisper-worker image with `queue:work redis-long --queue=captions
# --once` (never whisper-smoke), then asserts the result via
# `captions:whisper-smoke-verify`.
# ---------------------------------------------------------------------------
cmd_queued() {
  local model_id
  model_id="$(jq -r '.model_id' "$ROOT_DIR/docker/whisper/model.lock")"

  # Every whisper-smoke invocation below explicitly passes BOTH
  # DB_CONNECTION=pgsql AND DB_DATABASE=speechcoach — not just the
  # connection. compose.yaml's whisper-smoke service sets `DB_DATABASE:
  # ":memory:"` in its OWN `environment:` block (for `adapter`'s isolated
  # SQLite run), which otherwise silently wins over env_file's real
  # DB_DATABASE=speechcoach even once DB_CONNECTION is overridden to
  # pgsql — caught by actually running this command and finding a live
  # Postgres database literally named ":memory:" holding the migrated
  # schema while `whisper-worker` (no such override) looked for data in
  # the real `speechcoach` database and found nothing. `whisper-worker`
  # itself needs no override here since it has no `:memory:` default to
  # begin with.
  log "starting disposable postgres/seaweedfs/valkey"
  _compose up -d postgres seaweedfs valkey
  _compose up -d --wait postgres seaweedfs valkey

  log "running migrations + media:initialize (inside whisper-smoke, against this project's real Postgres/SeaweedFS)"
  _compose --profile whisper-smoke run --rm \
    -e APP_ENV=production -e DB_CONNECTION=pgsql -e DB_DATABASE=speechcoach -e QUEUE_CONNECTION=redis \
    whisper-smoke sh -c "php artisan migrate --force && php artisan media:initialize"

  log "seeding a real source asset + dispatching a real GenerateCaptions job (captions:whisper-smoke-seed)"
  local seed_output captions_asset_id
  seed_output="$(_compose --profile whisper-smoke run --rm \
    -e APP_ENV=production -e DB_CONNECTION=pgsql -e DB_DATABASE=speechcoach -e QUEUE_CONNECTION=redis \
    -e RUNS_WHISPER_SMOKE=1 -e WHISPER_MODEL_NAME="$model_id" \
    whisper-smoke php artisan captions:whisper-smoke-seed)"
  echo "$seed_output" >&2

  captions_asset_id="$(echo "$seed_output" | grep -o 'captions_asset_id=[0-9]*' | cut -d= -f2)"
  [ -n "$captions_asset_id" ] || fail "captions:whisper-smoke-seed did not print captions_asset_id=<id> — see output above"

  log "running the job through the ACTUAL whisper-worker image (queue:work --once)"
  _compose run --rm \
    -e DB_CONNECTION=pgsql -e DB_DATABASE=speechcoach -e QUEUE_CONNECTION=redis -e WHISPER_MODEL_NAME="$model_id" \
    whisper-worker \
    sh -c "php artisan queue:work redis-long --queue=captions --timeout=1800 --tries=1 --sleep=1 --once"

  log "asserting the result (captions:whisper-smoke-verify, captions_asset_id=$captions_asset_id)"
  _compose --profile whisper-smoke run --rm \
    -e APP_ENV=production -e DB_CONNECTION=pgsql -e DB_DATABASE=speechcoach -e QUEUE_CONNECTION=redis \
    -e RUNS_WHISPER_SMOKE=1 -e WHISPER_MODEL_NAME="$model_id" \
    whisper-smoke php artisan captions:whisper-smoke-verify "$captions_asset_id"

  log "inspecting the resolved whisper-worker compose service (queue/timeout ordering, CPU/memory, RO model mount)"
  _compose config whisper-worker | tee "$ARTIFACT_DIR/whisper-worker-resolved-config.yaml" >&2

  log "queued sign-off PASSED"
}

# ---------------------------------------------------------------------------
# down — scoped teardown of ONLY this project's containers/volumes/network.
# Host artifacts under artifacts/whisper-smoke are NEVER removed by this
# command (§6.4: "retaining the host artifacts").
# ---------------------------------------------------------------------------
cmd_down() {
  _compose down -v
  log "whisper-smoke stack '$PROJECT' torn down (host artifacts retained under $ARTIFACT_DIR)"
}

usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") <command>

  prepare                       sanity-check docker/jq + fixture/model.lock presence
  build                          build whisper-worker + whisper-smoke images
  model [--offline-idempotency]  populate this project's whisper-models volume;
                                  optionally prove the offline idempotency contract
  runtime                        ldd + whisper-cli --help against whisper-worker itself
  adapter                        run RealWhisperAdapterSmokeTest inside whisper-smoke
  queued                         full queued sign-off against disposable Postgres/
                                  SeaweedFS/Valkey through the real whisper-worker image
  down                            scoped 'docker compose down -v' for this project only
EOF
  exit 1
}

trap cleanup_on_failure EXIT
STACK_STARTED=1

case "${1:-}" in
  prepare) cmd_prepare ;;
  build) cmd_build ;;
  model) shift; cmd_model "${1:-}" ;;
  runtime) cmd_runtime ;;
  adapter) cmd_adapter ;;
  queued) cmd_queued ;;
  down) trap - EXIT; cmd_down ;;
  *) trap - EXIT; usage ;;
esac

trap - EXIT
