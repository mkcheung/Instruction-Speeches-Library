#!/bin/sh
# STEP-09 verification plan §6.1: idempotent, checksum-verified initializer
# for the whisper.cpp model file. Run by the `whisper-model-init` compose
# service (see compose.yaml) against the RW `whisper-models` volume — the
# `whisper-worker` service itself mounts that same volume read-only, so
# this script is the ONLY thing in the stack allowed to write into it.
#
# Contract (STEP-09-VERIFICATION-PLAN.md §6.1, item 4):
#   - download to a TEMP filename inside the target directory (same
#     filesystem, so the final rename is atomic — `mv` across filesystems
#     is a copy, not a rename);
#   - verify SHA-256 against docker/whisper/model.lock before it is ever
#     visible under its real name;
#   - checksum mismatch: delete the temp file, exit non-zero;
#   - a matching file already at the destination: exit 0 without
#     re-downloading (and without touching its mtime — this is what makes
#     the "run it twice, offline the second time" idempotency check valid).
#
# Deliberately POSIX `sh`, not bash — this runs inside the `whisper-worker`
# image (Alpine/php-fpm base), which only ships busybox ash.
set -eu

# ---------------------------------------------------------------------------
# Locations. MODEL_DIR is the mount point of the RW `whisper-models` volume
# in the `whisper-model-init` service; MODEL_LOCK is baked into the image
# (or bind-mounted in dev) alongside this script.
# ---------------------------------------------------------------------------
MODEL_DIR="${WHISPER_MODEL_DIR:-/models}"
MODEL_LOCK="${WHISPER_MODEL_LOCK:-/docker/whisper/model.lock}"

if ! command -v jq >/dev/null 2>&1; then
    echo "init-model.sh: jq is required but not installed" >&2
    exit 1
fi

if [ ! -f "$MODEL_LOCK" ]; then
    echo "init-model.sh: model lock file not found at $MODEL_LOCK" >&2
    exit 1
fi

FILENAME="$(jq -r '.filename' "$MODEL_LOCK")"
DOWNLOAD_URL="$(jq -r '.download_url' "$MODEL_LOCK")"
EXPECTED_SHA256="$(jq -r '.sha256' "$MODEL_LOCK")"

if [ -z "$FILENAME" ] || [ "$FILENAME" = "null" ] \
    || [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ] \
    || [ -z "$EXPECTED_SHA256" ] || [ "$EXPECTED_SHA256" = "null" ]; then
    echo "init-model.sh: model lock file is missing filename/download_url/sha256" >&2
    exit 1
fi

DEST="$MODEL_DIR/$FILENAME"
TMP="$MODEL_DIR/.${FILENAME}.tmp$$"

mkdir -p "$MODEL_DIR"

# ---------------------------------------------------------------------------
# Idempotency: a file already at the destination that hashes correctly
# means we are done — no download, no write, no mtime change. A file that
# exists but hashes WRONG is treated as corrupt and is re-fetched (it is
# never silently trusted just because a name matches).
# ---------------------------------------------------------------------------
if [ -f "$DEST" ]; then
    actual_sha256="$(sha256sum "$DEST" | awk '{print $1}')"
    if [ "$actual_sha256" = "$EXPECTED_SHA256" ]; then
        echo "init-model.sh: $DEST already present and checksum-verified; skipping download"
        exit 0
    fi
    echo "init-model.sh: $DEST exists but checksum does not match model.lock (expected $EXPECTED_SHA256, got $actual_sha256) — re-downloading" >&2
fi

cleanup() {
    rm -f "$TMP"
}
trap cleanup EXIT INT TERM

echo "init-model.sh: downloading $DOWNLOAD_URL -> $TMP"
if ! curl -fsSL --retry 3 --retry-connrefused -o "$TMP" "$DOWNLOAD_URL"; then
    echo "init-model.sh: download failed" >&2
    exit 1
fi

actual_sha256="$(sha256sum "$TMP" | awk '{print $1}')"
if [ "$actual_sha256" != "$EXPECTED_SHA256" ]; then
    echo "init-model.sh: checksum mismatch for $FILENAME (expected $EXPECTED_SHA256, got $actual_sha256) — deleting temp file" >&2
    rm -f "$TMP"
    trap - EXIT INT TERM
    exit 1
fi

# Atomic rename: same directory/filesystem as $TMP, so this cannot leave a
# half-written file at $DEST even under a crash mid-`mv`.
mv "$TMP" "$DEST"
trap - EXIT INT TERM

echo "init-model.sh: $DEST installed and checksum-verified ($EXPECTED_SHA256)"
