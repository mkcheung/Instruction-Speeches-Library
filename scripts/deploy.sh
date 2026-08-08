#!/usr/bin/env bash
#
# Deploy this repo's api/ to the target server.
#
# THE BIG IDEA — why a half-succeeded deploy is impossible:
# it is the ORDERING, not error handling. Everything uploads into a BRAND NEW
# directory that nothing is serving. Exactly one statement changes what is live
# (the `mv -T` in step 5), and `set -e` guarantees a failure in steps 1-4 never
# reaches it. Fail at any earlier point and the running site never noticed.
#
. "$(dirname "$0")/_ssh.sh"

RELEASE="$(new_release)"
REL_DIR="$DEPLOY_PATH/releases/$RELEASE"
SHARED="$DEPLOY_PATH/shared"

# A release that never reached cutover must not survive. Otherwise rollback.sh
# will happily promote a half-uploaded or failed-migration directory — and
# because release names are timestamps, an orphan is always NEWER than what is
# live, so "newest release that isn't current" picks it every single time.
CUTOVER_DONE=0
UPLOAD_STARTED=0
deploy_cleanup() {
  rc=$?
  # NEVER touch a release that went live. CUTOVER_DONE is set only after the
  # atomic swap returned 0, so a post-cutover failure leaves the new code up.
  if [ "$rc" -ne 0 ] && [ "$CUTOVER_DONE" -eq 0 ] && [ "$UPLOAD_STARTED" -eq 1 ]; then
    echo "==> cleanup: removing orphaned release $RELEASE" >&2
    remote "rm -rf '$REL_DIR'" || echo "==> cleanup: could not reach host; $REL_DIR may remain" >&2
  fi
  rm -rf "$WORK"
  return $rc
}
trap deploy_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "==> 1/6 preflight"
# Every `remote` call can fail two very different ways, and a bare `|| { ... }`
# cannot tell them apart:
#   exit 1   the command ran and said no  -> your fault, fix the server
#   exit 255 ssh itself failed            -> network, auth, or host key
# Collapsing both into one message is how you end up debugging a missing file
# that is actually a dead network. Check the code.
preflight() {  # $1 = remote test, $2 = what it means when it legitimately fails
  local rc=0
  remote "$1" || rc=$?
  case "$rc" in
    0)   return 0 ;;
    255) echo "FATAL: cannot reach ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PORT} (ssh exit 255)" >&2
         echo "       dead host, wrong key, or DEPLOY_HOST_KEY does not match the server" >&2
         exit 255 ;;
    *)   echo "FATAL: $2" >&2; exit "$rc" ;;
  esac
}

preflight 'command -v php >/dev/null && command -v rsync >/dev/null' \
          "php or rsync missing on the target"
preflight "test -f '$SHARED/.env'" \
          "$SHARED/.env missing — run ../speechcoach-deploy-target/bin/provision.sh"

echo "==> 2/6 upload -> $REL_DIR"
UPLOAD_STARTED=1
remote "mkdir -p '$REL_DIR'"          # openrsync (macOS) has no --mkpath
rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'vendor' \
  --exclude '.env' --exclude 'storage' \
  --exclude 'bootstrap/cache/*.php' --exclude 'tests' \
  -e "ssh ${SSH_OPTS[*]}" \
  "$REPO_ROOT/api/" "${DEPLOY_USER}@${DEPLOY_HOST}:${REL_DIR}/"

echo "==> 3/6 wire shared state"
# vendor is COPIED, never symlinked.
#
# A symlink here looks harmless and quietly breaks everything: PHP resolves
# symlinks for __DIR__, so the generated autoloader computes its base directory
# from the LINK TARGET. Point vendor/ at the image's tree and every `App\...`
# class loads from the image instead of the release you just uploaded. The
# deploy goes green, and nothing you shipped is actually running.
# Copying works because every path in the generated autoloader is __DIR__-relative.
remote "set -e
  umask 002
  ln -sfn '$SHARED/.env'    '$REL_DIR/.env'
  ln -sfn '$SHARED/storage' '$REL_DIR/storage'
  rm -rf '$REL_DIR/vendor'
  cp -R /var/www/html/vendor '$REL_DIR/vendor'
  # rsync lands the release as deploy:deploy 0755/0644, but php-fpm runs as
  # www-data and MUST be able to rewrite bootstrap/cache — Laravel regenerates
  # packages.php/services.php there whenever they go stale. Without this, the
  # first request after any cache clear is a hard 500.
  chgrp -R www-data '$REL_DIR' 2>/dev/null || true
  chmod 2775 '$REL_DIR/bootstrap/cache'
  chmod -f g+w '$REL_DIR/bootstrap/cache/'*.php 2>/dev/null || true"

echo "==> 4/6 migrate"
# A distinct, ordered step: run once, from one place, before the cutover.
# --force = don't prompt (artisan refuses to migrate non-interactively in
# production without it).
#
# `umask 002` is LOAD-BEARING, not hygiene. artisan writes
# storage/logs/laravel.log as `deploy`; with the default umask 022 that file
# lands 0644 and php-fpm (www-data) then cannot append to it, so every request
# that logs anything 500s. A shared group and the setgid bit give group
# OWNERSHIP — they never give group WRITE on a newly created file.
remote "umask 002 && cd '$REL_DIR' && php artisan migrate --force --no-interaction"

echo "==> 5/6 cutover"
# THE only statement that changes what is live.
# `mv -T` is MANDATORY. Without it, busybox mv DESCENDS INTO the directory the
# symlink points at, so `current` never changes and you end up with a stray
# current.tmp inside the OLD release.
#
# The history append is what gives rollback a real answer instead of a guess.
remote "set -e
  cd '$DEPLOY_PATH'
  ln -sfn '$REL_DIR' current.tmp
  mv -T   current.tmp current
  printf '%s\n' '$RELEASE' >> history
  readlink current"
CUTOVER_DONE=1

echo "==> 6/6 reload + prune"
# Reload php-fpm or the swap is invisible for up to two minutes (realpath cache).
remote 'doas /usr/local/bin/reload-fpm'
# Never prune the LIVE release. After a rollback, `current` is an older release
# and would sort into the delete tail. `sort -r | tail -n +N` is POSIX; GNU's
# `head -n -N` is not universal.
remote "set -e
  cd '$DEPLOY_PATH/releases'
  LIVE=\$(basename \"\$(readlink '$DEPLOY_PATH/current')\")
  ls -1 | grep -vFx \"\$LIVE\" | sort -r | tail -n +$KEEP_RELEASES | xargs -r rm -rf
  cd '$DEPLOY_PATH'
  if [ -f history ]; then
    : > history.tmp
    while IFS= read -r r; do [ -d \"releases/\$r\" ] && printf '%s\n' \"\$r\" >> history.tmp; done < history
    mv -f history.tmp history
  fi"

echo "deployed $RELEASE"
