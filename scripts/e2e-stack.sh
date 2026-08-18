#!/usr/bin/env bash
#
# STEP-09 E2E verification plan §3.1: "Add one authoritative
# `scripts/e2e-stack.sh` harness. It owns both compose files, a dedicated
# project name, an overridden network name ..., deterministic
# environment/cert preparation, migrations/media initialization/seeding,
# and scoped teardown. It must either parameterize ports/origins or fail
# clearly when the dev stack already owns 443/5433/8333; it never stops
# the developer's stack."
#
# THE BIG IDEA: every command below runs against `-p "$PROJECT"` (a
# project name distinct from whatever `docker compose` on its own would
# pick for this directory) plus BOTH compose files together. Nothing in
# this script — and nothing that calls it — may invoke a bare
# `docker compose` without both `-p "$PROJECT"` and both `-f` flags, or it
# silently falls back to touching the developer's own dev-stack project.
# `_compose()` below is the one seam that enforces that.
#
# Ports: compose.yaml's `web`/`postgres`/`seaweedfs` publish 443/5433/8333
# on the host. compose.e2e.yaml keeps those exact numbers unchanged (so
# Playwright's hard-coded https://app.speechcoach.test etc. need no special
# E2E config), which means `up` can only ever succeed if either (a) nothing
# is listening there yet, or (b) this exact E2E project already owns them
# (a previous `up` left the stack running — re-running `up` must be safe).
# If a THIRD party — most likely the developer's own running dev stack —
# owns one of those ports, `up` fails loudly and does not touch it. This
# is the "fail clearly" branch the plan allows instead of parameterizing
# ports; parameterizing them would break every hard-coded
# https://app.speechcoach.test in web/tests/*.spec.ts and this plan's own
# §8 command list, for no real benefit (a developer only ever needs ONE of
# dev-or-E2E answering those ports at a time on one machine).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT="speechcoach-e2e"
CERT_DIR="$ROOT_DIR/docker/certs-e2e"
HOSTS=(app.speechcoach.test api.speechcoach.test media.speechcoach.test)
GUARDED_PORTS=(443 5433 8333)

_compose() {
  docker compose -p "$PROJECT" -f compose.yaml -f compose.e2e.yaml "$@"
}

log() { echo "==> $*" >&2; }
fail() { echo "!!! $*" >&2; exit 1; }

# Guards against ever tearing down anything but the validated E2E project —
# the one thing this trap is allowed to run `down -v` against.
UP_STARTED=0
cleanup_on_up_failure() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ "$UP_STARTED" -eq 1 ]; then
    log "up failed (exit $rc) — tearing down the partially-started '$PROJECT' project only"
    _compose down -v || log "cleanup itself failed; inspect 'docker compose -p $PROJECT ps' by hand"
  fi
  return $rc
}

# ---------------------------------------------------------------------------
# port_owned_by_us PORT — 0 (free to use) if nothing is listening, or every
# container publishing PORT belongs to $PROJECT already; 1 (blocked) if some
# OTHER container (almost certainly the dev stack) owns it.
# ---------------------------------------------------------------------------
port_owned_by_us() {
  local port="$1"
  local owners
  owners="$(docker ps --filter "publish=${port}" --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null || true)"

  if [ -z "$owners" ]; then
    return 0
  fi

  local owner
  while IFS= read -r owner; do
    [ -z "$owner" ] && continue
    if [ "$owner" != "$PROJECT" ]; then
      return 1
    fi
  done <<< "$owners"

  return 0
}

require_free_ports() {
  local blocked=()
  local port
  for port in "${GUARDED_PORTS[@]}"; do
    if ! port_owned_by_us "$port"; then
      blocked+=("$port")
    fi
  done

  if [ "${#blocked[@]}" -gt 0 ]; then
    fail "port(s) ${blocked[*]} are already published by a container outside the '$PROJECT' project (most likely the dev stack — 'docker compose up' from the repo root). This harness NEVER stops the developer's stack; stop whatever owns those ports yourself, or run this against a host that doesn't have the dev stack up."
  fi
}

# ---------------------------------------------------------------------------
# prepare — deterministic cert + /etc/hosts setup. Idempotent: safe to
# call before every 'up', not just once.
# ---------------------------------------------------------------------------
cmd_prepare() {
  mkdir -p "$CERT_DIR"

  if [ -f "$CERT_DIR/speechcoach-e2e.pem" ] && [ -f "$CERT_DIR/speechcoach-e2e-key.pem" ]; then
    log "E2E cert already present at $CERT_DIR — leaving it (delete the directory to force regeneration)"
  else
    command -v mkcert >/dev/null 2>&1 || fail "mkcert not found on PATH — install it (https://github.com/FiloSottile/mkcert) before running 'prepare'. This is a SEPARATE cert from docker/certs/ (the dev stack's own), covering all three E2E hostnames including media.speechcoach.test."
    log "generating E2E TLS cert for ${HOSTS[*]}"
    mkcert -install >/dev/null
    mkcert -cert-file "$CERT_DIR/speechcoach-e2e.pem" \
           -key-file  "$CERT_DIR/speechcoach-e2e-key.pem" \
           "${HOSTS[@]}"
  fi

  local missing=()
  local host
  for host in "${HOSTS[@]}"; do
    if ! getent hosts "$host" >/dev/null 2>&1 && ! dscacheutil -q host -a name "$host" >/dev/null 2>&1 && ! grep -qE "^[^#]*\s${host}(\s|\$)" /etc/hosts 2>/dev/null; then
      missing+=("$host")
    fi
  done

  if [ "${#missing[@]}" -gt 0 ]; then
    log "the following hostnames are not in /etc/hosts and must resolve to 127.0.0.1:"
    for host in "${missing[@]}"; do
      echo "    127.0.0.1  $host" >&2
    done
    log "add them yourself (requires root), e.g.:"
    echo "    printf '%s\n' $(printf '\"127.0.0.1  %s\" ' "${missing[@]}") | sudo tee -a /etc/hosts" >&2
    fail "missing /etc/hosts entries — see above. This script deliberately does not sudo on your behalf."
  else
    log "/etc/hosts already has entries for ${HOSTS[*]}"
  fi

  log "prepare complete"
}

# ---------------------------------------------------------------------------
# up [--fresh] — build + start the full E2E stack, migrate, initialize
# media, seed (E2ESeeder only — the caption fixture seeder is a separate,
# not-yet-built task per the plan's §3.3), start the default queue worker,
# and explicitly stop whisper-worker (plan §7 point 5: "leaves the Whisper
# worker stopped" for the required browser lane) and caption-test-worker
# (plan §3.1/§4.2 point 3 — "stopped by default"; only the worker-
# isolation/old-attempt-race scripts start/release it).
# ---------------------------------------------------------------------------
cmd_up() {
  local fresh=0
  if [ "${1:-}" = "--fresh" ]; then
    fresh=1
  fi

  require_free_ports

  trap cleanup_on_up_failure EXIT
  UP_STARTED=1

  if [ "$fresh" -eq 1 ]; then
    log "--fresh: deleting only the '$PROJECT' project's own volumes"
    _compose down -v || true
  fi

  log "building images"
  _compose build

  log "starting services"
  _compose up -d

  log "waiting for compose-level health"
  _compose up -d --wait

  log "running migrations"
  _compose exec -T app php artisan migrate --force

  log "initializing media bucket + CORS"
  _compose exec -T app php artisan media:initialize

  log "seeding baseline fixtures (E2ESeeder — users/auth only; caption fixtures are a separate seeder/task)"
  _compose exec -T app php artisan db:seed --class=E2ESeeder --force || log "E2ESeeder not found/failed — if it hasn't landed yet on this branch, seed manually before running Playwright"

  log "starting the default queue worker is already handled by compose's 'queue-worker' service; confirming it's up"
  _compose up -d --wait queue-worker

  log "stopping whisper-worker (required browser lane never touches real Whisper — plan §7)"
  _compose stop whisper-worker || true

  log "stopping caption-test-worker (stopped by default — plan §3.1/§4.2 point 3: only the worker-isolation/old-attempt-race scripts start it explicitly)"
  _compose stop caption-test-worker || true

  trap - EXIT
  log "E2E stack '$PROJECT' is up"
}

# ---------------------------------------------------------------------------
# nginx-test — `nginx -t` inside the running E2E web container, proving
# docker/nginx/e2e.conf actually parses/loads before any browser test runs
# against it.
# ---------------------------------------------------------------------------
cmd_nginx_test() {
  _compose exec -T web nginx -t
}

# ---------------------------------------------------------------------------
# verify-signed-media — plan §3.1 point 7: "Prove a presigned GET returns
# the committed MP4 and a byte-range request returns 206 before writing
# caption assertions." The committed caption-fixture MP4 itself belongs to
# the not-yet-built E2ECaptionsSeeder (plan §3.3, explicitly out of scope
# here); this instead proves the exact same mechanism — a real
# MediaUrlSigner-presigned URL served through the media.speechcoach.test
# TLS proxy in front of SeaweedFS — against a small object this command
# writes and cleans up itself, so it has no dependency on that seeder
# landing first.
# ---------------------------------------------------------------------------
cmd_verify_signed_media() {
  local key="e2e-smoke/verify-signed-media.bin"
  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' RETURN

  log "writing a known test object to the media disk"
  _compose exec -T app php artisan tinker --execute="
    \$ok = Storage::disk('media')->put('${key}', str_repeat('A', 65536), ['ContentType' => 'application/octet-stream']);
    if (! \$ok) { fwrite(STDERR, 'write failed'.PHP_EOL); exit(1); }
    echo 'written'.PHP_EOL;
  "

  log "presigning a GET URL via MediaUrlSigner"
  local url
  url="$(_compose exec -T app php artisan tinker --execute="
    echo (new App\Services\MediaUrlSigner)->presign('${key}', 300);
  " | tr -d '\r' | tail -n1)"

  [ -n "$url" ] || fail "MediaUrlSigner produced no URL"
  log "presigned URL: $url"

  log "GET (expect 200, full 65536-byte body)"
  local status size
  status="$(curl -sk -o "$tmp" -w '%{http_code}' "$url")"
  [ "$status" = "200" ] || fail "GET returned $status, expected 200"
  size="$(wc -c < "$tmp" | tr -d ' ')"
  [ "$size" = "65536" ] || fail "GET body was $size bytes, expected 65536"

  log "byte-range GET (expect 206 + Content-Range)"
  local headers
  headers="$(curl -sk -D - -o /dev/null -H 'Range: bytes=0-1023' "$url")"
  echo "$headers" | grep -qE '^HTTP/[0-9.]+ 206' || fail "range request did not return 206:\n$headers"
  echo "$headers" | grep -qi '^Content-Range: bytes 0-1023/65536' || fail "range response missing/incorrect Content-Range:\n$headers"

  log "cleaning up the test object"
  _compose exec -T app php artisan tinker --execute="Storage::disk('media')->delete('${key}');" >/dev/null

  log "verify-signed-media: PASS (real presigned GET + real 206 byte-range through media.speechcoach.test)"
}

# ---------------------------------------------------------------------------
# down — scoped teardown of ONLY this project's containers/volumes/network.
# ---------------------------------------------------------------------------
cmd_down() {
  _compose down -v
  log "E2E stack '$PROJECT' torn down"
}

usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") <command>

  prepare              generate the E2E TLS cert (docker/certs-e2e/) and
                        check /etc/hosts for app./api./media.speechcoach.test
  up [--fresh]          build+start the E2E stack, migrate, media:initialize,
                        seed, start default queue worker, stop whisper-worker
                        (--fresh deletes only this project's own volumes first)
  nginx-test             'nginx -t' inside the running E2E web container
  verify-signed-media    prove a real presigned GET (200) and byte-range
                        GET (206) through media.speechcoach.test
  down                   scoped 'docker compose down -v' for this project only
EOF
  exit 1
}

case "${1:-}" in
  prepare) cmd_prepare ;;
  up) shift; cmd_up "${1:-}" ;;
  nginx-test) cmd_nginx_test ;;
  verify-signed-media) cmd_verify_signed_media ;;
  down) cmd_down ;;
  *) usage ;;
esac
