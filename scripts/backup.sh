#!/usr/bin/env bash
#
# Back up the database and media for this stack.
#
# WHICH "PRODUCTION": this backs up the main DEV STACK's postgres (database
# `speechcoach`, the one `docker compose up -d` in THIS repo brings up) and
# its `seaweedfs-data` volume — not the faux deploy-target's
# `speechcoach_deploy` database. Reason: the deploy-target's database is
# whatever got migrated into it by a practice deploy (schema only, no real
# rows as of this writing); the dev stack's `speechcoach` database has this
# project's actual accumulated seed/test data (15 users as of this script's
# last real run — see BACKUP-RESTORE-DRILL.md). A backup script proved
# against a database with nothing in it proves nothing. The mechanism below
# (pg_dump + volume tarball) is identical regardless of which Postgres you
# point it at — only CONTAINER/DB names would change to target the real
# deploy-target or a real production host instead.
#
# WHY `docker exec`, not SSH to a remote host: this repo's own dev stack is
# reachable directly by container name on the machine running this script
# (unlike speechcoach-deploy-target, which exists specifically to practise
# the SSH-based deploy mechanics). `pg_dump` inside the postgres container
# avoids installing a matching client version on the host entirely — the
# container already has the exact pg_dump that matches its own server.
# Pointing this at a real remote production host later would mean swapping
# `docker exec $PG` for `ssh ... pg_dump` (or running pg_dump from a bastion
# with network access to the DB) — same two artifacts, different transport.
#
# RPO / RTO — stated now, while there is no real traffic, precisely so they
# are an actual commitment and not a number invented after an incident:
#
#   RPO (Recovery Point Objective): up to 24 HOURS of data loss.
#   Driven by: this script is intended to run once nightly (cron/systemd
#   timer on a real host; see the "real host" note at the bottom). On a
#   single box with no WAL archiving/replication, the worst case is "lose
#   everything since last night's dump" — which is what a nightly full dump
#   honestly buys you. Tightening this later means WAL-E/pgBackRest
#   continuous archiving, not a faster cron.
#
#   RTO (Recovery Time Objective): 15 MINUTES, wall-clock, to a scratch
#   environment with data verified readable. See BACKUP-RESTORE-DRILL.md for
#   the actual measured number from a real run of scripts/restore-drill.sh
#   against a backup this script produced — that file states both the claim
#   and the measurement together, per STEP-14's own acceptance wording.
#
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -P "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$REPO_ROOT/backups/$STAMP"
mkdir -p "$OUT_DIR"

DB_NAME="${BACKUP_DB_NAME:-speechcoach}"
DB_USER="${BACKUP_DB_USER:-speechcoach}"
VOLUME_NAME="${BACKUP_SEAWEED_VOLUME:-instruction-speeches-library_seaweedfs-data}"

echo "==> 1/2 database: $DB_NAME"
PG="$(docker ps --format '{{.Names}}' | grep -m1 'postgres' || true)"
if [ -z "$PG" ]; then
  echo "FATAL: no postgres container running. Start the stack first: docker compose up -d" >&2
  exit 1
fi
# -Fc (custom format): compressed, and the only format pg_restore can target
# selectively/in parallel — a plain SQL dump would also work for this single-
# database case, but -Fc is the format that still works if this script is
# ever pointed at a multi-database host.
docker exec "$PG" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$OUT_DIR/db.dump"
DB_SIZE=$(du -h "$OUT_DIR/db.dump" | cut -f1)
echo "    wrote $OUT_DIR/db.dump ($DB_SIZE)"

echo "==> 2/2 media: seaweedfs-data volume"
if ! docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
  echo "FATAL: volume '$VOLUME_NAME' not found. List volumes: docker volume ls" >&2
  exit 1
fi
# A throwaway container mounts the NAMED VOLUME read-only and tars it to a
# bind-mounted output directory — this never touches the running seaweedfs
# container, so a backup can never contend with live uploads for a lock.
docker run --rm \
  -v "${VOLUME_NAME}:/data:ro" \
  -v "$OUT_DIR:/backup" \
  alpine:3.20 \
  tar czf /backup/media.tar.gz -C /data .
MEDIA_SIZE=$(du -h "$OUT_DIR/media.tar.gz" | cut -f1)
echo "    wrote $OUT_DIR/media.tar.gz ($MEDIA_SIZE)"

printf '%s\n' "$STAMP" > "$OUT_DIR/MANIFEST"
printf 'db_name=%s\n' "$DB_NAME" >> "$OUT_DIR/MANIFEST"
printf 'db_user=%s\n' "$DB_USER" >> "$OUT_DIR/MANIFEST"
printf 'volume=%s\n' "$VOLUME_NAME" >> "$OUT_DIR/MANIFEST"

echo
echo "backup complete: $OUT_DIR"
echo "restore-drill:   ./scripts/restore-drill.sh '$OUT_DIR'"

# A real production host would run this from cron or a systemd timer (see
# ../speechcoach-deploy-target/systemd/ for this project's systemd
# conventions), nightly, writing to storage OFF the box it's backing up
# (object storage, a second disk, anything that survives the box dying) —
# a backup that lives only on the machine it backs up is not a backup
# either, same spirit as "an untested backup is not a backup."
