<?php

namespace App\Models;

use Database\Factories\ReportFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Support\Carbon;

/**
 * STEP-11-FROZEN-CONTRACT.md §1. `reportable_type`/`reportable_id` is a
 * bare morph pair with no FK, mirroring `notifications.notifiable` — the
 * controller resolves `reportable_type` server-side to `Speech`/`Review`
 * only (see App\Http\Controllers\Api\ReportController), never a
 * client-supplied class string.
 *
 * `@property` block: raw `DB::statement` migration (CHECK constraints),
 * invisible to Larastan's Blueprint-AST scanner — same reason every other
 * raw-SQL model in this codebase carries one.
 *
 * @property int $id
 * @property string $reportable_type
 * @property int $reportable_id
 * @property int|null $reporter_id
 * @property string $reason
 * @property string|null $detail
 * @property string $state
 * @property int|null $resolved_by_id
 * @property Carbon|null $resolved_at
 * @property string|null $resolution_note
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'reportable_type', 'reportable_id', 'reporter_id', 'reason', 'detail',
    'state', 'resolved_by_id', 'resolved_at', 'resolution_note',
])]
class Report extends Model
{
    /** @use HasFactory<ReportFactory> */
    use HasFactory;

    /** Allowed report targets (STEP-11-FROZEN-CONTRACT.md §1). */
    public const REPORTABLE_TYPES = [
        'speech' => Speech::class,
        'review' => Review::class,
    ];

    /** States a report queue needs (STEP-12 admin queue reads these). */
    public const STATES = ['open', 'actioned', 'dismissed'];

    public const REASONS = ['harassment', 'inappropriate_content', 'impersonation', 'spam', 'other'];

    /**
     * @return MorphTo<Model, $this>
     */
    public function reportable(): MorphTo
    {
        return $this->morphTo();
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function reporter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reporter_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function resolvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by_id');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'resolved_at' => 'datetime',
        ];
    }
}
