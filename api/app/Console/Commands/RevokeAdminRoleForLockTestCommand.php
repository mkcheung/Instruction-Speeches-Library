<?php

namespace App\Console\Commands;

use App\Exceptions\LastAdministratorException;
use App\Models\User;
use App\Services\RoleAssignmentService;
use Illuminate\Console\Command;

/**
 * STEP-12-FROZEN-CONTRACT.md §8: the artisan-level hook
 * scripts/verify-postgres-last-admin-lock.sh fires twice, concurrently, at
 * the last two admins — proving `pg_advisory_xact_lock(hashtext(
 * 'admin_roster'))` actually serializes two concurrent PHP processes
 * against a real Postgres, which sqlite (the Pest suite's driver) cannot
 * exercise at all. Same shape as the existing `user:grant-role` command
 * (the S1 substitute for an admin UI) — a thin artisan wrapper around the
 * real service, not a parallel code path.
 *
 * Exit 0 on a successful revoke, exit 1 (never a raw fatal) on
 * LastAdministratorException — the shell script asserts on exit codes,
 * not stdout parsing.
 */
class RevokeAdminRoleForLockTestCommand extends Command
{
    protected $signature = 'admin:revoke-for-lock-test {user : User id or email}';

    protected $description = 'Revoke the admin role from the given user via RoleAssignmentService (test/CI concurrency harness only).';

    public function handle(RoleAssignmentService $roles): int
    {
        $identifier = $this->argument('user');

        $target = is_numeric($identifier)
            ? User::query()->find($identifier)
            : User::query()->where('email', $identifier)->first();

        if ($target === null) {
            $this->error("No user found matching \"{$identifier}\".");

            return self::FAILURE;
        }

        try {
            $roles->revoke($target, $target, 'admin');
        } catch (LastAdministratorException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        $this->info("Revoked admin role from {$target->email} (id {$target->id}).");

        return self::SUCCESS;
    }
}
