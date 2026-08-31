#!/usr/bin/env bash
#
# STEP-12-FROZEN-CONTRACT.md §8: `pg_advisory_xact_lock(hashtext(
# 'admin_roster'))` has no sqlite equivalent, and this is genuinely new —
# no PHPUnit/Pest-level test can exercise two REAL concurrent processes
# racing the same Postgres advisory lock. Follows the existing shell-script
# precedent (scripts/verify-postgres-caption-schema.sh,
# scripts/verify-postgres-voice-schema.sh), except this one drives real
# artisan invocations rather than only querying the catalog: it seeds the
# last two admins, fires two concurrent
# `admin:revoke-for-lock-test` processes at them (App\Console\Commands\
# RevokeAdminRoleForLockTestCommand -> RoleAssignmentService::revoke()),
# and asserts exactly one succeeds.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT="${VERIFY_POSTGRES_PROJECT:-speechcoach-e2e}"
COMPOSE_FILES=(-f compose.yaml -f compose.e2e.yaml)

_compose() {
  docker compose -p "$PROJECT" "${COMPOSE_FILES[@]}" "$@"
}

log() { echo "==> $*" >&2; }
fail() { echo "!!! $*" >&2; exit 1; }

log "seeding roles and two admin users for the concurrency race"
_compose exec -T app php artisan db:seed --class="Database\\Seeders\\RoleSeeder" --force >/dev/null

# Two real bugs in this script, both found only by actually running it
# against the live e2e stack (previously "written but unrun," per this
# project's own tracked history):
#
# 1. NOT User::factory() — the `app` service is built from the production
#    `runtime` target (`--no-dev` composer install), so `fakerphp/faker`
#    isn't installed there and Laravel's own `fake()` helper is never even
#    defined (guarded by `class_exists(\Faker\Factory::class)` in
#    Illuminate's helpers.php — confirmed by reading it directly).
#    `User::factory()` calls `fake()` internally and fails with "Call to
#    undefined function ... fake()" in this exact container.
# 2. NOT User::query()->create()/updateOrCreate() with a plain field
#    array either — `username`/`email_verified_at` aren't in `User`'s
#    `#[Fillable(...)]` list, and this environment throws
#    MassAssignmentException on the attempt (confirmed directly; the
#    exact same field list is what `E2ESeeder::seedUsers()` passes to
#    `updateOrCreate()`, which is a real, currently-latent bug in that
#    seeder too, out of scope to fix here). `forceFill()` bypasses mass-
#    assignment guarding entirely, which is correct for a CI-only fixture
#    script whose whole job is writing exactly the columns it names.
# 3. This script runs as one of several "Verify Postgres ..." steps
#    against the SAME already-seeded e2e stack — `E2ESeeder` has already
#    created its own real `super_admin`/`admin` fixture pair
#    (super-admin@e2e.test / admin@e2e.test). Without stripping those
#    roles first, the two new test users below are never actually "the
#    last two admins," `remainingAdminCountExcluding()` always sees the
#    E2ESeeder fixtures as cover, and BOTH concurrent revokes trivially
#    succeed — a false pass on the race itself, confirmed by running this
#    script before this fix and observing exactly that (`got 2`, not the
#    expected `got 1`). Every OTHER admin/super_admin is demoted to
#    `member` before the race so the two seeded users genuinely are the
#    whole roster.
SEED_OUTPUT="$(_compose exec -T app php artisan tinker --execute="
App\Models\User::role(['admin', 'super_admin'])->get()->each(function (\$u) {
    \$u->syncRoles(['member']);
});
\$a = new App\Models\User;
\$a->forceFill(['email' => 'lock-test-admin-1@example.test', 'first_name' => 'Lock', 'last_name' => 'TestOne', 'username' => 'lock-test-admin-1', 'password' => \Illuminate\Support\Facades\Hash::make('password'), 'email_verified_at' => now()])->save();
\$a->assignRole('admin');
\$b = new App\Models\User;
\$b->forceFill(['email' => 'lock-test-admin-2@example.test', 'first_name' => 'Lock', 'last_name' => 'TestTwo', 'username' => 'lock-test-admin-2', 'password' => \Illuminate\Support\Facades\Hash::make('password'), 'email_verified_at' => now()])->save();
\$b->assignRole('admin');
echo \$a->id . ',' . \$b->id;
")"
IDS="$(echo "$SEED_OUTPUT" | tr -d '\r' | tail -n1)"
ADMIN_1_ID="${IDS%%,*}"
ADMIN_2_ID="${IDS##*,}"

[ -n "$ADMIN_1_ID" ] && [ -n "$ADMIN_2_ID" ] && [ "$ADMIN_1_ID" != "$ADMIN_2_ID" ] \
  || fail "could not seed two distinct admin ids (got: '$IDS')"

log "admin ids: $ADMIN_1_ID, $ADMIN_2_ID — firing two concurrent revokes"

set +e
_compose exec -T app php artisan admin:revoke-for-lock-test "$ADMIN_1_ID" >/tmp/lock-test-1.log 2>&1 &
PID_1=$!
_compose exec -T app php artisan admin:revoke-for-lock-test "$ADMIN_2_ID" >/tmp/lock-test-2.log 2>&1 &
PID_2=$!

wait "$PID_1"
RESULT_1=$?
wait "$PID_2"
RESULT_2=$?
set -e

log "process 1 exit=$RESULT_1, process 2 exit=$RESULT_2"
cat /tmp/lock-test-1.log >&2
cat /tmp/lock-test-2.log >&2

SUCCESSES=0
[ "$RESULT_1" -eq 0 ] && SUCCESSES=$((SUCCESSES + 1))
[ "$RESULT_2" -eq 0 ] && SUCCESSES=$((SUCCESSES + 1))

[ "$SUCCESSES" -eq 1 ] || fail "expected exactly ONE of the two concurrent revokes to succeed, got $SUCCESSES"

REMAINING_ADMINS="$(_compose exec -T postgres psql -U "${DB_USERNAME:-speechcoach}" -d "${DB_DATABASE:-speechcoach}" -Atc "
  SELECT count(*) FROM model_has_roles mhr
  JOIN roles r ON r.id = mhr.role_id
  JOIN users u ON u.id = mhr.model_id
  WHERE r.name = 'admin' AND u.id IN ($ADMIN_1_ID, $ADMIN_2_ID);
" | tr -d '\r')"

[ "$REMAINING_ADMINS" -eq 1 ] || fail "expected exactly 1 of the two seeded users to still hold the admin role, found $REMAINING_ADMINS"

log "verify-postgres-last-admin-lock: PASS (exactly one of two concurrent last-admin revokes succeeded)"
