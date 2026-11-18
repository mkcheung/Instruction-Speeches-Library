<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * STEP-11-FROZEN-CONTRACT.md §2. The first genuinely append-only table in
 * this schema: `public $timestamps = false` (no `updated_at` — Eloquent's
 * default timestamp handling always touches `updated_at`, which this table
 * doesn't have), and there is deliberately no update/delete path anywhere
 * on this model or any call site in the codebase. If a future change ever
 * adds `AuditLog::query()->update(...)` or `->delete()`/`->find(...)->
 * delete()`, that is a bug against this table's whole reason to exist —
 * flag it in review, don't add it.
 *
 * Written only from controllers/services, immediately after the real
 * action succeeds — never from inside a Policy (§14: `Gate::allows()` is
 * invoked speculatively in loops and Filament column-visibility checks, so
 * a policy-embedded write would log reads that never happened).
 *
 * @property int $id
 * @property int|null $actor_id
 * @property string $action
 * @property string|null $subject_type
 * @property int|null $subject_id
 * @property array<string,mixed> $metadata
 * @property string|null $ip
 * @property string|null $user_agent
 * @property Carbon $created_at
 */
#[Fillable(['actor_id', 'action', 'subject_type', 'subject_id', 'metadata', 'ip', 'user_agent', 'created_at'])]
class AuditLog extends Model
{
    public $timestamps = false;

    protected $table = 'audit_log';

    /**
     * Appends one audit row. Call it where the audited action has just succeeded, inside that action's
     * transaction where there is one (STEP-11-FROZEN-CONTRACT.md §2). Rows are never updated or deleted.
     *
     * @param  array<string, mixed>  $metadata
     */
    public static function record(
        string $action,
        ?int $actorId,
        ?string $subjectType,
        ?int $subjectId,
        array $metadata,
        ?Request $request = null,
    ): self {
        return self::query()->create([
            'actor_id' => $actorId,
            'action' => $action,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId,
            'metadata' => $metadata,
            'ip' => $request?->ip(),
            'user_agent' => $request?->userAgent(),
            'created_at' => now(),
        ]);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'metadata' => 'array',
            'created_at' => 'datetime',
        ];
    }
}
