<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Privacy\AccountErasureService;
use App\Services\Privacy\ErasurePlan;
use Illuminate\Console\Command;

/**
 * `php artisan privacy:erase --dry-run {user}` — STEP-11.md's own text:
 * "The ordered deletion job has no UI by design — its artifact is a CLI
 * command whose output *is* the specification." STEP-11-FROZEN-CONTRACT.md
 * §6: the printed order below IS §11.2/§6, so it must name each of the 8
 * steps, in this exact order, with a real count — never a placeholder.
 *
 * Templated on App\Console\Commands\MediaReconcileCommand's shape: plain
 * `$this->info()` output, no table/progress-bar dependency.
 */
class PrivacyEraseCommand extends Command
{
    protected $signature = 'privacy:erase
        {user : ID of the user to erase}
        {--dry-run : Print the ordered plan with row/byte counts, without executing anything}
        {--force : Skip the confirmation prompt on the destructive (non-dry-run) path}';

    protected $description = 'Erase a user account per STEP-11-FROZEN-CONTRACT.md §6 (dry-run prints the plan; without --dry-run it actually executes).';

    public function handle(AccountErasureService $service): int
    {
        $user = User::query()->find((int) $this->argument('user'));

        if ($user === null) {
            $this->error('No such user.');

            return self::FAILURE;
        }

        if ($this->option('dry-run')) {
            $this->info("Erasure plan for user #{$user->id} ({$user->email}) — DRY RUN, nothing executed:");
            $this->printPlan($service->plan($user));

            return self::SUCCESS;
        }

        // Unlike --dry-run, this is irreversible — a mistyped/pasted user
        // id here permanently erases the wrong account with no operator
        // safety net. Laravel's own destructive commands (migrate:fresh)
        // prompt; this one should too. --force skips it for scripted/CI use.
        if (! $this->option('force') && ! $this->confirm("Permanently erase user #{$user->id} ({$user->email})? This cannot be undone.")) {
            $this->warn('Aborted.');

            return self::SUCCESS;
        }

        $this->info("Erasing user #{$user->id} ({$user->email})...");
        $plan = $service->execute($user);
        $this->info('Erasure complete:');
        $this->printPlan($plan);

        return self::SUCCESS;
    }

    private function printPlan(ErasurePlan $plan): void
    {
        foreach ($plan->steps as $step) {
            $this->info(sprintf('%s — %d row(s), %d byte(s)', $step['label'], $step['count'], $step['bytes']));
        }
    }
}
