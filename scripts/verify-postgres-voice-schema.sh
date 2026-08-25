#!/usr/bin/env bash
# Verify the STEP-10 constraints that SQLite cannot prove are present in the
# migrated PostgreSQL catalog used by the isolated E2E stack.
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

psql_value() {
  _compose exec -T postgres psql \
    -U "${DB_USERNAME:-speechcoach}" \
    -d "${DB_DATABASE:-speechcoach}" \
    -Atc "$1" | tr -d '\r'
}

constraint_definition() {
  psql_value "
    SELECT pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = '$1' AND c.conname = '$2';
  "
}

log "checking voice-note kind/format and non-primary constraints"
KIND="$(constraint_definition speech_assets ck_speech_assets_kind)"
FORMAT="$(constraint_definition speech_assets ck_speech_assets_format)"
PAIR="$(constraint_definition speech_assets ck_speech_assets_kind_format)"
NON_PRIMARY="$(constraint_definition speech_assets ck_voice_note_not_primary)"

[[ "$KIND" == *"voice_note"* ]] || fail "ck_speech_assets_kind does not permit voice_note"
[[ "$FORMAT" == *"m4a"* ]] || fail "ck_speech_assets_format does not permit m4a"
[[ "$PAIR" == *"voice_note"* && "$PAIR" == *"m4a"* ]] || fail "kind/format CHECK does not bind voice_note to m4a"
[[ "$NON_PRIMARY" == *"voice_note"* && "$NON_PRIMARY" == *"is_primary"* ]] || fail "voice-note non-primary CHECK is missing"

log "checking transcript state CHECK and audio FK ON DELETE SET NULL"
TRANSCRIPT="$(constraint_definition annotations ck_annotations_transcript_status)"
for state in not_applicable pending processing ready failed; do
  [[ "$TRANSCRIPT" == *"$state"* ]] || fail "transcript CHECK is missing state '$state'"
done

FK_DELETE="$(psql_value "
  SELECT c.confdeltype
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'annotations' AND c.contype = 'f'
    AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (audio_asset_id)%';
")"
[ "$FK_DELETE" = "n" ] || fail "annotations.audio_asset_id is not ON DELETE SET NULL (confdeltype='$FK_DELETE')"

log "checking voice uniqueness indexes and preservation of existing asset indexes"
INDEXES="$(psql_value "
  SELECT indexname || '|' || indexdef
  FROM pg_indexes
  WHERE tablename IN ('annotations', 'speech_assets')
    AND indexname IN ('uq_annotations_audio_asset', 'uq_assets_primary', 'uq_assets_captions_one_per_speech')
  ORDER BY indexname;
")"
for index in uq_annotations_audio_asset uq_assets_primary uq_assets_captions_one_per_speech; do
  [[ "$INDEXES" == *"$index|CREATE UNIQUE INDEX"* ]] || fail "required unique index '$index' is missing"
done

log "verify-postgres-voice-schema: PASS"
