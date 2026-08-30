<?php

namespace App\Console\Commands;

use App\Models\Report;
use Illuminate\Console\Command;

/**
 * `php artisan reports:list` — STEP-11-FROZEN-CONTRACT.md §1: "reports
 * land in a table and `php artisan reports:list` prints them until
 * step 12" (the admin report queue). Templated on
 * App\Console\Commands\MediaReconcileCommand's shape: plain `$this->info()`
 * / `$this->table()` output, oldest-open-first.
 */
class ReportsListCommand extends Command
{
    protected $signature = 'reports:list';

    protected $description = 'List reports, oldest-open-first (STEP-11-FROZEN-CONTRACT.md §1) — the admin queue UI arrives in STEP-12.';

    public function handle(): int
    {
        $reports = Report::query()
            ->orderByRaw("CASE WHEN state = 'open' THEN 0 ELSE 1 END")
            ->orderBy('created_at')
            ->with(['reporter'])
            ->get();

        if ($reports->isEmpty()) {
            $this->info('No reports.');

            return self::SUCCESS;
        }

        $this->table(
            ['id', 'type', 'target', 'reporter', 'reason', 'state', 'created_at'],
            $reports->map(fn (Report $report) => [
                $report->id,
                $report->reportable_type,
                $report->reportable_id,
                $report->reporter === null ? ($report->reporter_id ?? '(none)') : $report->reporter->username,
                $report->reason,
                $report->state,
                $report->created_at,
            ]),
        );

        return self::SUCCESS;
    }
}
