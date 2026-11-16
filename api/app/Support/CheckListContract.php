<?php

namespace App\Support;

use App\Enums\SpeechAssetStatus;
use App\Enums\TranscriptStatus;
use App\Models\DataExport;
use App\Models\Report;
use Illuminate\Database\Connection;
use RuntimeException;

/**
 * The value lists that database CHECK constraints enforce, each tied to the PHP list that owns
 * it (PLAN-DRY-SCHEMA-STATUS-CONTRACT.md).
 *
 * Migrations keep literal lists and never call app code: an enum edit must not change what a
 * fresh `migrate` builds for an old migration. This class is the drift guard instead. It reads
 * every `CHECK (column IN ('a', …))` from the live catalog (sqlite_master on SQLite,
 * pg_get_constraintdef() on PostgreSQL) and compares each list, as a set, to its owner.
 *
 * Run by tests/Feature/Schema/CheckListContractTest.php (SQLite) and by
 * `php artisan schema:check-lists` from scripts/verify-postgres-check-lists.sh (PostgreSQL).
 * Conventions: api/database/migrations/README.md.
 */
final class CheckListContract
{
    /** Value-list CHECKs with no single PHP owner yet: table.column => what would own it. */
    public const UNOWNED = [
        'annotations.kind' => 'AnnotationRules::metadata() inlines the list; extract a constant',
        'annotations.timing_type' => "'range'/'point' literals in AnnotationTiming; a timing-type enum",
        'application_documents.status' => 'no PHP list yet',
        'coach_applications.status' => 'no full PHP list; STATUS_BADGES omits draft on purpose',
        'connections.state' => 'no PHP list yet',
        'data_exports.status' => 'no PHP list yet; not SpeechAssetStatus (no uploading)',
        'reviews.status' => 'no full PHP list; Review::ACCESS_GRANTING is a subset',
        'speech_assets.format' => 'no PHP list yet; pairs with ck_speech_assets_kind_format',
        'speech_assets.kind' => 'no full PHP list; PurgeSpeechMedia::PURGED_KINDS is a subset',
        'speech_transcripts.source' => 'no PHP list yet',
    ];

    /** `CHECK (column IN ('a', …))`, optionally named, in sqlite_master text (any case, quoting, whitespace). */
    private const SQLITE_LIST = <<<'REGEX'
        /(?:\bCONSTRAINT\s+["`\[]?(?<name>\w+)["`\]]?\s+)?\bCHECK\s*\(\s*["`\[]?(?<column>\w+)["`\]]?\s+IN\s*\((?<list>\s*'(?:[^']|'')*'(?:\s*,\s*'(?:[^']|'')*')*\s*)\)\s*\)/i
        REGEX;

    /** The same CHECK as pg_get_constraintdef() normalizes it for a VARCHAR column; anything else is not a list. */
    private const PGSQL_LIST = <<<'REGEX'
        /^CHECK \(\(\((?<column>\w+)\)::text = ANY \(\(ARRAY\[(?<list>'(?:[^']|'')*'::character varying(?:, '(?:[^']|'')*'::character varying)*)\]\)::text\[\]\)\)\)$/
        REGEX;

    /**
     * table.column => the PHP list that owns it.
     *
     * @return array<string, array{owner: class-string, label: string, values: list<string>}>
     */
    public static function contracts(): array
    {
        return [
            'annotations.transcript_status' => ['owner' => TranscriptStatus::class, 'label' => 'TranscriptStatus::values()', 'values' => TranscriptStatus::values()],
            'data_exports.kind' => ['owner' => DataExport::class, 'label' => 'DataExport::KINDS', 'values' => DataExport::KINDS],
            'reports.reason' => ['owner' => Report::class, 'label' => 'Report::REASONS', 'values' => Report::REASONS],
            'reports.state' => ['owner' => Report::class, 'label' => 'Report::STATES', 'values' => Report::STATES],
            'speech_assets.status' => ['owner' => SpeechAssetStatus::class, 'label' => 'SpeechAssetStatus::values()', 'values' => SpeechAssetStatus::values()],
        ];
    }

    /**
     * Every value-list CHECK in the live schema, keyed table.column (several hits for one key is drift).
     *
     * @return array<string, list<array{name: string|null, values: list<string>}>>
     */
    public static function liveLists(Connection $db): array
    {
        $found = [];
        $driver = $db->getDriverName();

        if ($driver === 'sqlite') {
            $tables = $db->select("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL");
            foreach ($tables as $table) {
                foreach (self::parseSqliteTable((string) $table->sql) as $hit) {
                    $found[$table->name.'.'.$hit['column']][] = ['name' => $hit['name'], 'values' => $hit['values']];
                }
            }
        } elseif ($driver === 'pgsql') {
            $checks = $db->select(<<<'SQL'
                SELECT t.relname AS table_name, c.conname AS name, pg_get_constraintdef(c.oid) AS definition
                FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE c.contype = 'c' AND n.nspname = current_schema()
                SQL);
            foreach ($checks as $check) {
                $hit = self::parsePostgresDefinition((string) $check->definition);
                if ($hit !== null) {
                    $found[$check->table_name.'.'.$hit['column']][] = ['name' => (string) $check->name, 'values' => $hit['values']];
                }
            }
        } else {
            throw new RuntimeException("CheckListContract reads sqlite and pgsql catalogs, not {$driver}.");
        }

        ksort($found);

        return $found;
    }

    /**
     * Every way the live schema disagrees with contracts() and UNOWNED; empty means no drift.
     *
     * @return list<string>
     */
    public static function drift(Connection $db): array
    {
        return self::compare(self::liveLists($db), self::contracts(), self::UNOWNED);
    }

    /**
     * drift() without the database, so each rule is unit-testable on made-up lists.
     *
     * @param  array<string, list<array{name: string|null, values: list<string>}>>  $live
     * @param  array<string, array{owner: class-string, label: string, values: list<string>}>  $contracts
     * @param  array<string, string>  $unowned
     * @return list<string>
     */
    public static function compare(array $live, array $contracts, array $unowned): array
    {
        $problems = [];

        foreach (array_keys(array_intersect_key($contracts, $unowned)) as $key) {
            $problems[] = "{$key}: listed in both contracts() and UNOWNED";
        }
        foreach ($live as $key => $hits) {
            if (count($hits) > 1) {
                $problems[] = "{$key}: ".count($hits).' value-list CHECKs on one column; expected one';
            }
            if (! isset($contracts[$key]) && ! array_key_exists($key, $unowned)) {
                $problems[] = "{$key}: value-list CHECK with no PHP owner; add it to CheckListContract::contracts() or UNOWNED (api/database/migrations/README.md)";
            }
        }
        foreach ($contracts as $key => $contract) {
            $actual = $live[$key][0]['values'] ?? null;
            if ($actual === null) {
                $problems[] = "{$key}: no value-list CHECK found for {$contract['label']}";

                continue;
            }
            $lacks = array_values(array_diff($contract['values'], $actual));
            $adds = array_values(array_diff($actual, $contract['values']));
            if ($lacks !== [] || $adds !== [] || count($actual) !== count(array_unique($actual))) {
                $problems[] = sprintf('%s: CHECK differs from %s (database lacks [%s]; database adds [%s]; %d values in the CHECK)',
                    $key, $contract['label'], implode(', ', $lacks), implode(', ', $adds), count($actual));
            }
        }
        foreach (array_keys($unowned) as $key) {
            if (! isset($live[$key])) {
                $problems[] = "{$key}: listed in UNOWNED but no such CHECK exists; remove the entry";
            }
        }

        return $problems;
    }

    /** @return list<array{column: string, name: string|null, values: list<string>}> */
    public static function parseSqliteTable(string $createSql): array
    {
        preg_match_all(self::SQLITE_LIST, $createSql, $matches, PREG_SET_ORDER | PREG_UNMATCHED_AS_NULL);

        return array_map(fn (array $m): array => [
            'column' => (string) $m['column'],
            'name' => $m['name'],
            'values' => self::literals((string) $m['list']),
        ], $matches);
    }

    /** @return array{column: string, values: list<string>}|null */
    public static function parsePostgresDefinition(string $definition): ?array
    {
        if (preg_match(self::PGSQL_LIST, $definition, $m) !== 1) {
            return null;
        }

        return ['column' => $m['column'], 'values' => self::literals($m['list'])];
    }

    /** @return list<string> */
    private static function literals(string $list): array
    {
        preg_match_all("/'((?:[^']|'')*)'/", $list, $m);

        return array_map(fn (string $value): string => str_replace("''", "'", $value), $m[1]);
    }
}
