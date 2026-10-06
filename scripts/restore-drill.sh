#!/usr/bin/env bash
#
# Restore a backup produced by scripts/backup.sh into a throwaway SCRATCH
# environment, verify the data is actually readable, and time the whole
# thing. "An untested backup is not a backup" (STEP-14) — this is the test.
#
# SCRATCH, not staging, not production: a dedicated Compose PROJECT name
# (speechcoach-restore-drill) with its OWN postgres container and its OWN
# anonymous volume. It never touches `instruction-speeches-library_postgres-
# data` or `_seaweedfs-data` — restoring into a copy of production is the
# whole point of a drill; restoring into production and calling it a drill
# would just be a second way to break production.
#
# Usage:
#   ./scripts/backup.sh                              # produces backups/<stamp>/
#   ./scripts/restore-drill.sh backups/<stamp>        # restores that backup
#
set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -P "$SCRIPT_DIR/.." && pwd)"

BACKUP_DIR="${1:?usage: $0 <backup-dir produced by scripts/backup.sh>}"
case "$BACKUP_DIR" in
  /*) : ;;                                  # already absolute
  *)  BACKUP_DIR="$REPO_ROOT/$BACKUP_DIR" ;;
esac
[ -f "$BACKUP_DIR/db.dump" ]      || { echo "FATAL: $BACKUP_DIR/db.dump not found" >&2; exit 1; }
[ -f "$BACKUP_DIR/media.tar.gz" ] || { echo "FATAL: $BACKUP_DIR/media.tar.gz not found" >&2; exit 1; }

PROJECT="speechcoach-restore-drill"
CONTAINER="${PROJECT}-postgres-1"
DRILL_DB="speechcoach_drill"
DRILL_USER="speechcoach"
DRILL_PASSWORD="speechcoach"

cleanup() {
  echo "==> cleanup: removing scratch container and volume"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "${PROJECT}_postgres-data" >/dev/null 2>&1 || true
  docker volume rm "${PROJECT}_media-data" >/dev/null 2>&1 || true
}
# Clean up on exit NO MATTER WHAT (success, failure, Ctrl-C) — a leftover
# scratch container from a previous drill would otherwise shadow this one's
# "is it actually restoring" signal with stale data from last time.
echo "==> 0/4 clearing any stale scratch environment from a previous run"
cleanup
trap cleanup EXIT INT TERM

START_EPOCH=$(date +%s)
echo "==> drill started $(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "==> 1/4 starting a throwaway Postgres"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER="$DRILL_USER" \
  -e POSTGRES_PASSWORD="$DRILL_PASSWORD" \
  -e POSTGRES_DB="$DRILL_DB" \
  -v "${PROJECT}_postgres-data:/var/lib/postgresql/data" \
  postgres:17-alpine >/dev/null

echo "    waiting for it to accept connections..."
# The official postgres image starts a TEMPORARY server to run initdb, stops
# it, then starts the REAL one — `pg_isready` can return success during that
# temporary server's brief window, right before it shuts down again. Waiting
# for "database system is ready to accept connections" to appear TWICE in
# the log (once per server) is what the image's own entrypoint comments
# document as the real signal; a single pg_isready success is not enough.
for _ in $(seq 1 60); do
  READY_COUNT=$(docker logs "$CONTAINER" 2>&1 | grep -c "database system is ready to accept connections" || true)
  if [ "$READY_COUNT" -ge 2 ] && docker exec "$CONTAINER" pg_isready -U "$DRILL_USER" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U "$DRILL_USER" >/dev/null \
  || { echo "FATAL: scratch postgres never became ready" >&2; exit 1; }

echo "==> 2/4 restoring database dump"
# Copy the dump INTO the container rather than piping over a long-lived
# `docker exec -i`: pg_restore's own progress/error output is then
# unambiguously about the restore, not mixed with a streaming-copy failure.
docker cp "$BACKUP_DIR/db.dump" "$CONTAINER:/tmp/db.dump"
docker exec "$CONTAINER" pg_restore -U "$DRILL_USER" -d "$DRILL_DB" --no-owner --no-privileges /tmp/db.dump

echo "==> 3/4 restoring media tarball"
# A second anonymous volume stands in for a restored seaweedfs data
# directory. This drill verifies the ARCHIVE is intact and extractable
# (the actual risk a backup script protects against — a corrupt or
# truncated tarball); standing up a full seaweedfs server to serve the
# restored files back over S3 is a heavier drill than §14's acceptance
# line asks for ("a backup is restored... successfully, and the elapsed
# time is written down") and is not done here.
docker run --rm \
  -v "${PROJECT}_media-data:/data" \
  -v "$BACKUP_DIR:/backup:ro" \
  alpine:3.20 \
  tar xzf /backup/media.tar.gz -C /data
MEDIA_FILE_COUNT=$(docker run --rm -v "${PROJECT}_media-data:/data" alpine:3.20 sh -c 'find /data -type f | wc -l')
echo "    extracted $MEDIA_FILE_COUNT files into the scratch media volume"

echo "==> 4/4 verifying the restored data is actually readable"
USER_COUNT=$(docker exec "$CONTAINER" psql -U "$DRILL_USER" -d "$DRILL_DB" -tAc "SELECT count(*) FROM users;")
SPEECH_COUNT=$(docker exec "$CONTAINER" psql -U "$DRILL_USER" -d "$DRILL_DB" -tAc "SELECT count(*) FROM speeches;" 2>/dev/null || echo "N/A")
echo "    users table:    $USER_COUNT rows"
echo "    speeches table: $SPEECH_COUNT rows"

if [ "$USER_COUNT" -lt 1 ] 2>/dev/null; then
  echo "FATAL: restored users table is empty — this is not a successful restore" >&2
  exit 1
fi

END_EPOCH=$(date +%s)
ELAPSED=$((END_EPOCH - START_EPOCH))

echo
echo "==================================================================="
echo " RESTORE DRILL: SUCCESS"
echo "   database:   $USER_COUNT users, $SPEECH_COUNT speeches, readable"
echo "   media:      $MEDIA_FILE_COUNT files extracted"
echo "   elapsed:    ${ELAPSED}s"
echo "   claimed RTO: 15 minutes (900s) — see scripts/backup.sh and"
echo "                BACKUP-RESTORE-DRILL.md for the actual recorded run"
echo "==================================================================="
