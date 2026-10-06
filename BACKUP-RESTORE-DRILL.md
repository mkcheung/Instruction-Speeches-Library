# Backup restore drill — STEP-14

**Executed:** 2026-10-06 · **Against:** [STEP-14-deploy-hardening.md](STEP-14-deploy-hardening.md)'s ⚠️ acceptance line: "A backup is restored into a scratch environment successfully, and the elapsed time is written down next to the claimed RTO." · "An untested backup is not a backup."

---

## The claim, stated before the test

- **RPO (Recovery Point Objective): 24 hours.** `scripts/backup.sh` is a full `pg_dump` + media-volume tarball, meant to run once nightly on a real host (cron or a `speechcoach-deploy-target/systemd` timer). This is a single box with no WAL archiving or replication, so the honest worst case between two nightly runs is "lose everything since last night's dump." Tightening this later means continuous WAL archiving (WAL-E / pgBackRest), not a faster cron — that's out of scope for a zero-cost single-box deploy.
- **RTO (Recovery Time Objective): 15 minutes**, wall-clock, from "I have a backup" to "data is restored into a scratch environment and verified readable." This was a deliberately generous target given the actual data volume at this stage of the project (116 KB DB dump, 144 MB of media) — the number below shows it was not a close call.

## What was backed up and restored

"Production" for this drill means the main dev stack's `postgres` container
(database `speechcoach`) and its `seaweedfs-data` named volume — not the
`speechcoach-deploy-target` faux-server's `speechcoach_deploy` database,
which as of this run is freshly migrated and empty. The dev stack's database
has this project's actual accumulated data: 15 users, 4 speeches. A backup
drill against an empty database would prove nothing about whether the
mechanism actually works.

- `scripts/backup.sh` — `docker exec`'s the running postgres container for a
  `pg_dump -Fc`, and runs a throwaway `alpine` container that mounts the
  `seaweedfs-data` volume read-only and tars it, writing both to
  `backups/<UTC timestamp>/`.
- `scripts/restore-drill.sh <backup dir>` — brings up a **scratch**
  environment: its own `postgres:17-alpine` container
  (`speechcoach-restore-drill-postgres-1`) on its own anonymous volume, and
  a second scratch volume for the extracted media tarball. It never touches
  the real `postgres-data`/`seaweedfs-data` volumes. It restores the dump
  with `pg_restore`, extracts the media tarball, then verifies the data is
  actually readable (`SELECT count(*) FROM users`, `SELECT count(*) FROM
  speeches`, and a file count on the extracted media), and tears the scratch
  environment down whether it succeeds or fails.

## The actual run

```
$ ./scripts/backup.sh
==> 1/2 database: speechcoach
    wrote .../backups/20261006T052952Z/db.dump (116K)
==> 2/2 media: seaweedfs-data volume
    wrote .../backups/20261006T052952Z/media.tar.gz (144M)
backup complete: .../backups/20261006T052952Z

$ time ./scripts/restore-drill.sh backups/20261006T052952Z
==> 1/4 starting a throwaway Postgres
==> 2/4 restoring database dump
==> 3/4 restoring media tarball
    extracted 112 files into the scratch media volume
==> 4/4 verifying the restored data is actually readable
    users table:    15 rows
    speeches table: 4 rows

===================================================================
 RESTORE DRILL: SUCCESS
   database:   15 users, 4 speeches, readable
   media:      112 files extracted
   elapsed:    7s
===================================================================
real    0m7.984s
```

## Measured RTO next to the claimed RTO

| | |
|---|---|
| **Claimed RTO** | 15 minutes (900 s) |
| **Measured RTO** | **8 seconds** (script-internal elapsed: 7s; wall-clock `time`: 7.98s) |

The measured number is nowhere near the claim at today's data volume — that
headroom is deliberate, not evidence the claim was too loose. The slow part
of a real restore at this scale is not Postgres (a 116 KB dump restores
instantly); it's re-provisioning a scratch host and downloading a much larger
media tarball from wherever the backup actually lives once backups are
shipped off-box (not yet true in this repo — see `scripts/backup.sh`'s final
comment). The 15-minute claim is sized for that future state, not for the
current local-Docker drill. **This number should be re-measured after
backups move off-box and media volume grows past this step's toy size** — an
8-second drill against 144 MB proves the mechanism works, not that the
15-minute budget holds at real scale.

## What this drill did NOT cover

- It did not restore into a live, serving application — only `pg_restore` +
  `tar xzf` + a direct SQL read. Standing up a full `app` container against
  the restored database/media is a heavier drill than this acceptance line
  asks for ("restored... successfully, elapsed time written down").
- It did not test a corrupted or partial backup file — only the happy path.
  Worth a follow-up: verify `restore-drill.sh` fails loudly (not silently)
  against a truncated `db.dump`.
- Off-box backup storage does not exist yet — `backups/` is local to the
  machine running `scripts/backup.sh`, which means today's "backup" would
  not survive that machine's disk failing. Flagged honestly in
  `scripts/backup.sh`'s final comment; not fixed in this step.
