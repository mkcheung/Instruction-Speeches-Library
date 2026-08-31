#!/bin/sh
# STEP-12-admin-portal.md / STEP-12-FROZEN-CONTRACT.md §7: freshen the
# signature database at container start (best-effort — a build-time
# freshclam already seeded one, so a network hiccup here isn't fatal),
# then start clamd in the foreground. This freshclam pass is exactly the
# slow part compose.yaml's healthcheck has to wait out — clamd does not
# accept connections until its signature database is loaded, which can
# take minutes on first run.
set -eu

freshclam --config-file=/etc/clamav/freshclam.conf || echo "clamav-entrypoint: freshclam failed, continuing with the baked-in signature database" >&2

mkdir -p /run/clamav
chown clamav:clamav /run/clamav

exec clamd --config-file=/etc/clamav/clamd.conf
