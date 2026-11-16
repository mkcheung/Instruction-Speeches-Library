<?php

namespace App\Console\Commands;

use App\Support\CheckListContract;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Read-only: compares the live database's CHECK value lists to the PHP enums and constants that
 * own them (App\Support\CheckListContract). scripts/verify-postgres-check-lists.sh runs it on the
 * e2e PostgreSQL stack, which has no Pest; the Pest suite covers SQLite. The script asserts on the
 * exit code, not on parsed output (the same convention as RevokeAdminRoleForLockTestCommand).
 */
class CheckSchemaListsCommand extends Command
{
    protected $signature = 'schema:check-lists';

    protected $description = 'Compare the database CHECK value lists to the PHP enums and constants that own them (read-only).';

    public function handle(): int
    {
        $db = DB::connection();
        $live = CheckListContract::liveLists($db);
        $contracts = CheckListContract::contracts();
        $this->line(sprintf('driver=%s lists=%d contracted=%d unowned=%d',
            $db->getDriverName(), count($live), count($contracts), count(CheckListContract::UNOWNED)));

        $problems = $live === []
            ? ['no value-list CHECKs found; run this against a migrated database']
            : CheckListContract::compare($live, $contracts, CheckListContract::UNOWNED);
        foreach ($problems as $problem) {
            $this->error($problem);
        }

        return $problems === [] ? self::SUCCESS : self::FAILURE;
    }
}
