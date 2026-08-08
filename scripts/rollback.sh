#!/usr/bin/env bash
#
# Roll back to the previous release by POPPING the deploy history.
#
# WHY NOT "the newest release that isn't the current one"?
# Because that is not the same thing as "the one before this one", and the
# difference bites twice:
#   1. A failed deploy leaves an orphan directory with a NEWER timestamp than
#      what is live, so the naive rule promotes the broken release every time.
#   2. Roll back twice and it OSCILLATES: current=C picks B, then current=B
#      picks C — rolling you forward into the release you just backed out of.
#
# A one-slot "previous release" file does NOT fix the oscillation either; it
# just moves it (after C->B it records previous=C, so the next rollback goes
# B->C). Rollback needs a STACK, which is what `history` is.
#
# WHAT THIS DOES NOT DO: roll back the database. Laravel `down()` methods are
# frequently wrong or absent, and an automated destructive rollback against
# real data is worse than a broken deploy. Migrations are FORWARD-ONLY. A schema
# change that can't be rolled back must be expand/contract: add a nullable
# column -> deploy -> backfill -> deploy -> drop the old one.
#
. "$(dirname "$0")/_ssh.sh"

remote "set -e
  cd '$DEPLOY_PATH'
  [ -L current ] || { echo 'rollback: nothing is deployed' >&2; exit 1; }
  CUR=\$(basename \"\$(readlink current)\")
  [ -f history ] || { echo 'rollback: no deploy history recorded' >&2; exit 1; }

  # The top of the stack must be what is live. If it is not, something wrote
  # \`current\` outside the atomic step, and we refuse rather than guess.
  TOP=\$(tail -n 1 history)
  [ \"\$TOP\" = \"\$CUR\" ] || { echo \"rollback: history top (\$TOP) != current (\$CUR); refusing\" >&2; exit 1; }

  # Walk backwards for the newest entry below the top that is a COMPLETE,
  # still-present release. Skipping pruned or incomplete entries is what lets
  # this survive a prune that ate the immediate predecessor.
  TARGET=''
  KEPT=\$(sed '\$d' history)          # history minus the top
  while [ -n \"\$KEPT\" ]; do
    C=\$(printf '%s\n' \"\$KEPT\" | tail -n 1)
    if [ \"\$C\" != \"\$CUR\" ] \\
       && [ -d \"releases/\$C\" ] \\
       && [ -f \"releases/\$C/artisan\" ] \\
       && [ -f \"releases/\$C/vendor/autoload.php\" ] \\
       && [ -f \"releases/\$C/public/index.php\" ]; then
      TARGET=\$C; break
    fi
    echo \"rollback: skipping \$C (pruned or incomplete)\" >&2
    KEPT=\$(printf '%s\n' \"\$KEPT\" | sed '\$d')
  done
  [ -n \"\$TARGET\" ] || { echo 'rollback: no usable earlier release' >&2; exit 1; }

  ln -sfn '$DEPLOY_PATH/releases/'\"\$TARGET\" current.tmp
  mv -T current.tmp current
  # Pop only AFTER the swap succeeded, and pop everything we skipped too, so a
  # second rollback keeps walking backwards instead of oscillating.
  printf '%s\n' \"\$KEPT\" > history.tmp && mv -f history.tmp history
  readlink current"

remote 'doas /usr/local/bin/reload-fpm'
