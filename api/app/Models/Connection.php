<?php

namespace App\Models;

use Database\Factories\ConnectionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * MODERNIZATION_PLAN §6.7.2 / STEP-13-FROZEN-CONTRACT.md §3. A plain
 * Eloquent model over the `connections` table — deliberately no
 * mirrored-write logic here. Every write path goes through
 * App\Services\ConnectionService, which is the only place that knows how to
 * keep a pair's two rows (`owner_id`/`peer_id` swapped) in sync, always
 * lower-user-id-first. This model just reads/writes one row.
 *
 * Two mirrored rows exist per connected pair: this instance's `owner_id` is
 * "whose list this row is in", `peer_id` is the other party. `state` is
 * CHECK-enumerated at the migration level (sqlite can only acquire a CHECK
 * constraint at CREATE TABLE time) — never assign an out-of-set value here.
 *
 * @property int $id
 * @property int $owner_id
 * @property int $peer_id
 * @property string $state
 * @property int|null $initiated_by_id
 * @property int|null $blocked_by_id
 * @property Carbon|null $requested_at
 * @property Carbon|null $responded_at
 * @property Carbon|null $connected_at
 * @property string|null $note
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['owner_id', 'peer_id', 'state', 'initiated_by_id', 'blocked_by_id', 'requested_at', 'responded_at', 'connected_at', 'note'])]
class Connection extends Model
{
    /** @use HasFactory<ConnectionFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<User, $this>
     */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function peer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'peer_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function initiatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'initiated_by_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function blockedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'blocked_by_id');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'requested_at' => 'datetime',
            'responded_at' => 'datetime',
            'connected_at' => 'datetime',
        ];
    }
}
