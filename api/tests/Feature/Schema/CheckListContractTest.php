<?php

use App\Support\CheckListContract;
use Illuminate\Support\Facades\DB;

/**
 * PLAN-DRY-SCHEMA-STATUS-CONTRACT.md. The migrated SQLite schema's CHECK value lists equal their
 * PHP owners. scripts/verify-postgres-check-lists.sh runs the same comparison on PostgreSQL.
 * Migrations keep literal lists (api/database/migrations/README.md).
 */
it('finds every value-list CHECK the contract names, and no others', function () {
    $named = [...array_keys(CheckListContract::contracts()), ...array_keys(CheckListContract::UNOWNED)];
    sort($named);

    expect(array_keys(CheckListContract::liveLists(DB::connection())))->toBe($named)
        ->and(CheckListContract::contracts())->toHaveKey('speech_assets.status');
});

it('reads one non-empty list for each contracted CHECK', function (string $key) {
    $live = CheckListContract::liveLists(DB::connection());

    expect($live[$key] ?? [])->toHaveCount(1)
        ->and($live[$key][0]['values'])->not->toBeEmpty();
})->with(fn (): array => array_keys(CheckListContract::contracts()));

it('matches every contracted CHECK list to its PHP owner', function () {
    expect(CheckListContract::drift(DB::connection()))->toBe([]);
});

// The comparison above can't see a migration that builds its list from the owner: the database
// would then equal the enum by construction. The plan's rule forbids exactly that.
it('keeps the PHP owners out of the migrations they are checked against', function () {
    $files = glob(database_path('migrations/*.php')) ?: [];
    $owners = array_unique(array_column(CheckListContract::contracts(), 'owner'));
    $offenders = [];
    foreach ($files as $file) {
        $source = (string) file_get_contents($file);
        foreach ($owners as $owner) {
            if (str_contains($source, $owner) || str_contains($source, class_basename($owner).'::')) {
                $offenders[] = basename($file).' references '.$owner;
            }
        }
    }

    expect($files)->not->toBeEmpty()
        ->and($offenders)->toBe([]);
});

// Keep this test before the next one. RefreshDatabase rolls the column back (SQLite DDL is
// transactional), and the next test turns red if it ever leaks.
it('fails schema:check-lists on a value-list CHECK that no PHP list owns', function () {
    DB::statement("ALTER TABLE reports ADD COLUMN channel VARCHAR(8) NULL CHECK (channel IN ('web', 'api'))");

    $this->artisan('schema:check-lists')
        ->expectsOutputToContain('reports.channel: value-list CHECK with no PHP owner')
        ->assertFailed();
});

it('passes schema:check-lists on the migrated schema', function () {
    $this->artisan('schema:check-lists')
        ->expectsOutputToContain('driver=sqlite lists=15 contracted=5 unowned=10')
        ->assertSuccessful();
});
