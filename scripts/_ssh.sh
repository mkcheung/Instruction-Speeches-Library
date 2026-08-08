# shellcheck shell=bash
#
# Shared preamble, SOURCED by deploy.sh and rollback.sh (not executed).
# Factored out so rollback.sh isn't a 30-line copy-paste that drifts.
#
# The server this talks to lives in a separate repo: ../speechcoach-deploy-target

set -euo pipefail
# -e  stop on the first failure, so a broken step can never fall through to the
#     one that changes what is live
# -u  an unset variable is an error — catches a secret that didn't arrive
# -o pipefail  so `something | tee` cannot hide a nonzero exit

# Required. The `:?` form fails immediately with a useful message rather than
# letting an empty value produce a mysterious failure ten lines later.
: "${DEPLOY_HOST:?}"; : "${DEPLOY_KEY:?}"; : "${DEPLOY_HOST_KEY:?}"

DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PORT="${DEPLOY_PORT:-2222}"
DEPLOY_PATH="${DEPLOY_PATH:-/srv/speechcoach}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

# Resolve the repo root from THIS FILE's location, so the scripts work from any
# working directory. (`cd -P` + `pwd` is POSIX; `realpath` is not on stock macOS.)
SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -P "$SCRIPT_DIR/.." && pwd)"

# Release names: TIMESTAMP FIRST, sha second.
# `rsync -a` implies `-t`, so every release directory inherits the SOURCE
# directory's mtime — which means `ls -1t` can fall back to alphabetical order.
# A fixed-width UTC timestamp prefix makes LEXICAL sort chronological, so plain
# `ls -1 | sort` is correct and `ls -1t` is a bug. The name is the sort key on
# purpose; it does not depend on file timestamps at all.
#
# Deliberately a FUNCTION, not a top-level assignment: `git rev-parse` exits 128
# outside a checkout, and rollback.sh — which needs no release name at all — is
# exactly the script you run in a panic, possibly from your home directory.
new_release() {
  local sha="${GITHUB_SHA:-}"
  if [ -z "$sha" ]; then
    sha="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
  fi
  printf '%s-%s\n' "$(date -u +%Y%m%d%H%M%S)" "${sha:0:7}"
}

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
# EXIT alone misses Ctrl-C (INT) and a cancelled Actions run (TERM), either of
# which would leave the private key sitting in a temp directory.
trap cleanup EXIT INT TERM

umask 077                                  # applies to the NEXT file created —
printf '%s\n' "$DEPLOY_KEY" > "$WORK/id"   # so the key is never briefly 0644.
chmod 600 "$WORK/id"                       # printf, not echo: echo mangles backslashes

# known_hosts: this is how we say "I already know what this server's key is",
# which is the entire defence against someone answering *as* the server,
# accepting your deploy, and keeping your code.
#
# OpenSSH uses the bracketed `[host]:port` form ONLY for a NON-default port. On
# port 22 it looks up the BARE hostname, so an unconditional `[%s]:%s` line
# never matches and the deploy dies with `Host key verification failed` — the
# error everyone misreads as "my key is wrong". This matters the day you point
# these scripts at a real VPS on port 22.
if [ "$DEPLOY_PORT" = "22" ]; then
  printf '%s %s\n'      "$DEPLOY_HOST"                 "$DEPLOY_HOST_KEY" > "$WORK/known_hosts"
else
  printf '[%s]:%s %s\n' "$DEPLOY_HOST" "$DEPLOY_PORT"  "$DEPLOY_HOST_KEY" > "$WORK/known_hosts"
fi

# An ARRAY, not a string. A string is not word-split by zsh at all (so it
# arrives as one giant argument) and IS split on spaces by bash (so a path with
# a space breaks). Arrays keep each option a separate argument either way.
SSH_OPTS=(
  -i "$WORK/id"
  -p "$DEPLOY_PORT"
  -o IdentitiesOnly=yes                 # don't offer the agent's other keys
  -o BatchMode=yes                      # never prompt — a hung deploy is worse
  -o StrictHostKeyChecking=yes          # explicit, not implicit
  -o UserKnownHostsFile="$WORK/known_hosts"
  -o GlobalKnownHostsFile=/dev/null
  -o ConnectTimeout=10                  # a dead host fails in 10s, not 2min
)

remote() { ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "$@"; }
