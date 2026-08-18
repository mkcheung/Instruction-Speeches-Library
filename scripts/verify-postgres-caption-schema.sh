#!/usr/bin/env bash
#
# STEP-09-VERIFICATION-PLAN.md §4.2 item 4 / §7 item 8: "query the live
# catalog after migrations and assert speech_transcripts.body_tsv is a
# stored generated tsvector and speech_transcripts_body_tsv_gin is a GIN
# index. Do not assert planner costs on a tiny fixture." — sqlite (the Pest
# suite's driver) cannot express a generated tsvector column at all
# (2026_08_17_100002_create_speech_transcripts_table.php's own doc
# comment), so this is the ONE place that migration's Postgres branch is
# ever actually checked against a real Postgres catalog.
#
# Deliberately cheap: two catalog queries against `information_schema`/
# `pg_indexes`, not a data-shape assertion — the migration itself already
# has focused Pest coverage (SpeechTranscriptsMigrationTest.php) for
# everything sqlite CAN express.
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

log "checking speech_transcripts.body_tsv is a STORED GENERATED tsvector column"
GENERATED="$(_compose exec -T postgres psql -U "${DB_USERNAME:-speechcoach}" -d "${DB_DATABASE:-speechcoach}" -Atc "
  SELECT is_generated || '|' || data_type
  FROM information_schema.columns
  WHERE table_name = 'speech_transcripts' AND column_name = 'body_tsv';
" | tr -d '\r')"

[ -n "$GENERATED" ] || fail "speech_transcripts.body_tsv column not found"

IS_GENERATED="${GENERATED%%|*}"
DATA_TYPE="${GENERATED##*|}"

[ "$IS_GENERATED" = "ALWAYS" ] || fail "speech_transcripts.body_tsv is not a GENERATED ALWAYS column (is_generated='${IS_GENERATED}')"
[ "$DATA_TYPE" = "tsvector" ] || fail "speech_transcripts.body_tsv is not a tsvector column (data_type='${DATA_TYPE}')"

log "checking speech_transcripts_body_tsv_gin is a GIN index on speech_transcripts"
INDEX_ROW="$(_compose exec -T postgres psql -U "${DB_USERNAME:-speechcoach}" -d "${DB_DATABASE:-speechcoach}" -Atc "
  SELECT am.amname
  FROM pg_index i
  JOIN pg_class ic ON ic.oid = i.indexrelid
  JOIN pg_class tc ON tc.oid = i.indrelid
  JOIN pg_am am ON am.oid = ic.relam
  WHERE tc.relname = 'speech_transcripts' AND ic.relname = 'speech_transcripts_body_tsv_gin';
" | tr -d '\r')"

[ -n "$INDEX_ROW" ] || fail "index speech_transcripts_body_tsv_gin not found on speech_transcripts"
[ "$INDEX_ROW" = "gin" ] || fail "speech_transcripts_body_tsv_gin is not a GIN index (access method='${INDEX_ROW}')"

log "verify-postgres-caption-schema: PASS (body_tsv is a stored generated tsvector; speech_transcripts_body_tsv_gin is GIN)"
