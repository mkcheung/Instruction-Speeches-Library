#!/usr/bin/env bash
#
# STEP-09-VERIFICATION-PLAN.md §6.1 item 2 / §8 "Focused implementation
# gates": docker/whisper/model.lock is the single source of truth that
# init-model.sh, WHISPER_MODEL_NAME, the transcript writer, and both smoke
# layers all consume — this script is the cheap, PR-required check that
# lock file is well-formed and hasn't silently drifted from the Dockerfile,
# without paying for a model download or image build on every PR
# (.github/workflows/whisper-smoke.yml's `lock-check` job, kept separate
# from the real, weekly/dispatch-only `queued-smoke` job).
#
# §1's proof table for this check: "Proves: Immutable URL, recorded
# license, expected filename/model identity, and checksum syntax." /
# "Must not prove: Downloaded bytes or executable inference." Accordingly,
# `--metadata-only` is the ONLY mode this script implements: it parses the
# lock file and cross-checks static text against the Dockerfile, and it
# never opens a network connection or invokes Docker. The sha256 field is
# checked with a regex only (64 hex chars) — actually verifying it against
# downloaded bytes is docker/whisper/init-model.sh's and
# scripts/whisper-smoke-stack.sh's job, not this one's.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOCK_FILE="docker/whisper/model.lock"
DOCKERFILE="Dockerfile"

log() { echo "==> $*" >&2; }
fail() { echo "!!! $*" >&2; exit 1; }

if [ "${1:-}" != "--metadata-only" ]; then
  fail "usage: $0 --metadata-only (the only supported mode today; see this script's header comment and STEP-09-VERIFICATION-PLAN.md §1's proof table for why no other mode exists yet)"
fi

command -v jq >/dev/null 2>&1 || fail "jq is required but not found on PATH"

[ -f "$LOCK_FILE" ] || fail "$LOCK_FILE not found"
[ -f "$DOCKERFILE" ] || fail "$DOCKERFILE not found"

jq empty "$LOCK_FILE" 2>/dev/null || fail "$LOCK_FILE is not valid JSON"

log "checking required fields are present and non-empty in $LOCK_FILE"

get_field() {
  jq -r "$1 // empty" "$LOCK_FILE"
}

FILENAME="$(get_field '.filename')"
SOURCE_URL="$(get_field '.source_url')"
REVISION="$(get_field '.revision')"
DOWNLOAD_URL="$(get_field '.download_url')"
SHA256="$(get_field '.sha256')"
LICENSE_NAME="$(get_field '.license.name')"
LICENSE_URL="$(get_field '.license.url')"
WHISPER_CPP_COMMIT="$(get_field '.whisper_cpp_commit')"
MODEL_ID="$(get_field '.model_id')"

for pair in \
  "filename:$FILENAME" \
  "source_url:$SOURCE_URL" \
  "revision:$REVISION" \
  "download_url:$DOWNLOAD_URL" \
  "sha256:$SHA256" \
  "license.name:$LICENSE_NAME" \
  "license.url:$LICENSE_URL" \
  "whisper_cpp_commit:$WHISPER_CPP_COMMIT" \
  "model_id:$MODEL_ID"; do
  FIELD_NAME="${pair%%:*}"
  FIELD_VALUE="${pair#*:}"
  [ -n "$FIELD_VALUE" ] || fail "$LOCK_FILE is missing a non-empty '$FIELD_NAME' field"
done

log "checking download_url is an immutable, revision-pinned URL (contains the recorded revision)"
case "$DOWNLOAD_URL" in
  *"$REVISION"*) ;;
  *) fail "download_url ('$DOWNLOAD_URL') does not contain the recorded revision ('$REVISION') — it may not be immutable" ;;
esac

log "checking sha256 is syntactically a 64-hex-char checksum (no bytes downloaded or verified)"
if ! [[ "$SHA256" =~ ^[0-9a-fA-F]{64}$ ]]; then
  fail "sha256 field ('$SHA256') is not a syntactically valid 64-hex-char checksum"
fi

log "checking model_id ('$MODEL_ID') is <=64 characters"
if [ "${#MODEL_ID}" -gt 64 ]; then
  fail "model_id ('$MODEL_ID') is ${#MODEL_ID} characters, exceeds the 64-character limit"
fi

log "checking whisper_cpp_commit matches the pinned commit baked into $DOCKERFILE"
DOCKERFILE_COMMIT="$(grep -oE '^ARG WHISPER_CPP_COMMIT=[0-9a-fA-F]{40}' "$DOCKERFILE" | head -n1 | cut -d= -f2)"
[ -n "$DOCKERFILE_COMMIT" ] || fail "could not find a 'ARG WHISPER_CPP_COMMIT=<40-hex-char sha>' line in $DOCKERFILE"

if [ "$WHISPER_CPP_COMMIT" != "$DOCKERFILE_COMMIT" ]; then
  fail "whisper_cpp_commit in $LOCK_FILE ('$WHISPER_CPP_COMMIT') does not match WHISPER_CPP_COMMIT in $DOCKERFILE ('$DOCKERFILE_COMMIT') — they have drifted apart"
fi

log "verify-whisper-model-lock: PASS (filename=$FILENAME model_id=$MODEL_ID whisper_cpp_commit=$WHISPER_CPP_COMMIT license=$LICENSE_NAME)"
