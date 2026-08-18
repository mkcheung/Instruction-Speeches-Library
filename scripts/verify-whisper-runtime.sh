#!/bin/sh
# STEP-09 verification plan §6.1: proves the final `whisper-worker` image
# is actually runnable, not just buildable. Upstream whisper.cpp v1.7.2
# defaults to BUILD_SHARED_LIBS=ON on Linux, so a build that succeeds is
# NOT proof the resulting binary can start — only `ldd` against the final
# image layer (not the build stage) proves every shared library the
# binary needs is actually present there.
#
# Checks, against the built `whisper-worker` Dockerfile target:
#   1. `ldd /usr/local/bin/whisper-cli` reports zero "not found" entries.
#   2. `whisper-cli --help` exits 0.
#
# Run from the repository root:
#   ./scripts/verify-whisper-runtime.sh
#
# Deliberately does not touch the model volume, PostgreSQL, SeaweedFS, or
# Valkey — this is a narrow binary/library check, not the queued-worker
# smoke test (that is section 6.3 of the verification plan, explicitly out
# of scope here).
set -eu

cd "$(dirname "$0")/.."

IMAGE_TAG="${WHISPER_WORKER_VERIFY_TAG:-whisper-worker-runtime-check}"

echo "verify-whisper-runtime.sh: building whisper-worker target as $IMAGE_TAG"
docker build --target whisper-worker -t "$IMAGE_TAG" -f Dockerfile .

echo "verify-whisper-runtime.sh: running ldd against /usr/local/bin/whisper-cli"
LDD_OUTPUT="$(docker run --rm --user root "$IMAGE_TAG" ldd /usr/local/bin/whisper-cli)"
echo "$LDD_OUTPUT"

if echo "$LDD_OUTPUT" | grep -q "not found"; then
    echo "verify-whisper-runtime.sh: FAIL - ldd reports missing shared libraries" >&2
    exit 1
fi
echo "verify-whisper-runtime.sh: ldd OK, no missing libraries"

echo "verify-whisper-runtime.sh: running whisper-cli --help"
if ! docker run --rm "$IMAGE_TAG" /usr/local/bin/whisper-cli --help >/dev/null 2>&1; then
    echo "verify-whisper-runtime.sh: FAIL - whisper-cli --help did not exit 0" >&2
    exit 1
fi
echo "verify-whisper-runtime.sh: whisper-cli --help OK"

echo "verify-whisper-runtime.sh: PASS"
