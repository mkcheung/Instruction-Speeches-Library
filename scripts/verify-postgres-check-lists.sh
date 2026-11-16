#!/usr/bin/env bash
# PLAN-DRY-SCHEMA-STATUS-CONTRACT.md: every CHECK value list in the migrated
# PostgreSQL catalog of the isolated E2E stack must equal the PHP enum or
# constant that owns it (App\Support\CheckListContract). The Pest suite runs the
# same comparison on SQLite (tests/Feature/Schema/CheckListContractTest.php);
# this is the only place the migrations' PostgreSQL branches are compared.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT="${VERIFY_POSTGRES_PROJECT:-speechcoach-e2e}"
COMPOSE_FILES=(-f compose.yaml -f compose.e2e.yaml)

_compose() {
  docker compose -p "$PROJECT" "${COMPOSE_FILES[@]}" "$@"
}

log() { echo "==> $*" >&2; }
fail() { echo "!!! $*" >&2; exit 1; }

log "comparing PostgreSQL CHECK value lists to their PHP owners"
# Capture output and status together so a failure prints the command's own
# report rather than tripping `set -e` mid-assignment (the same shape as
# verify-caption-recovery-scheduler.sh's _tinker).
set +e
OUT="$(_compose exec -T app php artisan schema:check-lists 2>&1 | tr -d '\r')"
RC=$?
set -e
printf '%s\n' "$OUT" >&2

[ "$RC" -eq 0 ] || fail "schema:check-lists exited $RC"
[[ "$OUT" == *"driver=pgsql "* ]] || fail "schema:check-lists did not run against PostgreSQL"

log "verify-postgres-check-lists: PASS"
