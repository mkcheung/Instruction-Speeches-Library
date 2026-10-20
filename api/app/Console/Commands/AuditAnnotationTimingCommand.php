<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Read-only provenance inventory, usable before or after the timing migration. */
class AuditAnnotationTimingCommand extends Command
{
    protected $signature = 'annotations:timing-audit';

    protected $description = 'Print timing provenance counts and ambiguous row IDs without changing feedback.';

    public function handle(): int
    {
        $migrated = Schema::hasColumn('annotations', 'timing_type');
        $columns = ['id', 'review_id', 'audio_asset_id', 'transcript_status', 'deleted_at', 'start_seconds', 'duration_seconds'];
        if ($migrated) {
            $columns[] = 'timing_type';
        }
        // Never print commentary/transcript bodies in a maintenance inventory.
        $query = DB::table('annotations')->select($columns)->selectRaw("CASE WHEN body <> '' THEN 1 ELSE 0 END AS has_text")->orderBy('id');
        $counts = ['range' => 0, 'point' => 0, 'ambiguous_live' => 0, 'ambiguous_deleted' => 0];
        $ambiguous = [];
        foreach ($query->cursor() as $row) {
            $type = $migrated ? $row->timing_type : null;
            if (! $migrated) {
                if ($row->audio_asset_id !== null || $row->transcript_status !== 'not_applicable') {
                    $type = 'point';
                } elseif ($row->deleted_at === null && (int) $row->has_text === 1) {
                    $type = 'range';
                }
            }
            if ($type === 'range' || $type === 'point') {
                $counts[$type]++;
            } else {
                $counts[$row->deleted_at === null ? 'ambiguous_live' : 'ambiguous_deleted']++;
                $ambiguous[] = ['id' => (string) $row->id, 'review_id' => $row->review_id,
                    'deleted' => $row->deleted_at !== null, 'start_seconds' => $row->start_seconds,
                    'duration_seconds' => $row->duration_seconds];
            }
        }
        $this->line(json_encode(['read_only' => true, 'timing_column_present' => $migrated, 'counts' => $counts,
            'ambiguous' => $ambiguous, 'classification_required' => $ambiguous !== []], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT));

        return self::SUCCESS;
    }
}
