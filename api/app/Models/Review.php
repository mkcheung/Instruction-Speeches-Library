<?php

namespace App\Models;

use Database\Factories\ReviewFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * MODERNIZATION_PLAN §6.3, §6.11, §7.3, §7.5. A review row is the entire
 * access grant for a speech: a reviewer can only reach a speech's playback
 * URL through a review whose `status` is in ACCESS_GRANTING and whose
 * `revoked_at` is null (see Speech::scopeVisibleTo).
 *
 * `@property` block below is not decorative: the `reviews` migration is
 * raw `DB::statement` SQL (needed for the status CHECK and the counter-cache
 * CHECK — see the migration's own comment), so Larastan's migration-AST
 * column scanner, which reads `$table->column()` calls, cannot infer this
 * model's columns the way it does for a normal Blueprint table. Without
 * this block every property access below is an "undefined property"
 * Larastan error.
 *
 * @property int $id
 * @property int $speech_id
 * @property int|null $reviewer_id
 * @property int $speech_owner_id
 * @property int|null $invited_by_id
 * @property string|null $invitation_message
 * @property bool $allow_preview
 * @property bool $prior_commentary_shared
 * @property string $status
 * @property Carbon|null $invited_at
 * @property Carbon|null $responded_at
 * @property Carbon|null $first_published_at
 * @property Carbon|null $last_published_at
 * @property Carbon $last_transition_at
 * @property Carbon|null $revoked_at
 * @property int|null $revoked_by_id
 * @property string|null $revocation_reason
 * @property int $annotations_count
 * @property int $published_annotations_count
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'speech_id', 'reviewer_id', 'speech_owner_id', 'invited_by_id',
    'invitation_message', 'allow_preview', 'prior_commentary_shared',
    'status', 'invited_at', 'responded_at', 'first_published_at',
    'last_published_at', 'last_transition_at', 'revoked_at', 'revoked_by_id',
    'revocation_reason', 'annotations_count', 'published_annotations_count',
])]
class Review extends Model
{
    /** @use HasFactory<ReviewFactory> */
    use HasFactory;

    /**
     * Statuses under which a reviewer's grant is "live" — i.e. they can
     * reach the speech's signed playback URL (§7.3). Referenced by
     * Speech::scopeVisibleTo and by ReviewPolicy/SpeechPolicy in lieu of
     * the deferred `is_granting` generated column.
     *
     * @var list<string>
     */
    const ACCESS_GRANTING = ['accepted', 'in_progress', 'published'];

    /**
     * @return BelongsTo<Speech, $this>
     */
    public function speech(): BelongsTo
    {
        return $this->belongsTo(Speech::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewer_id');
    }

    /**
     * The inviter's speech-owner identity, denormalized and immutable —
     * see the migration's own comment for why this is a separate column
     * rather than a join through `speech`.
     *
     * @return BelongsTo<User, $this>
     */
    public function speechOwner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'speech_owner_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function invitedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function revokedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'revoked_by_id');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'allow_preview' => 'boolean',
            'prior_commentary_shared' => 'boolean',
            'invited_at' => 'datetime',
            'responded_at' => 'datetime',
            'first_published_at' => 'datetime',
            'last_published_at' => 'datetime',
            'last_transition_at' => 'datetime',
            'revoked_at' => 'datetime',
            'annotations_count' => 'integer',
            'published_annotations_count' => 'integer',
        ];
    }
}
