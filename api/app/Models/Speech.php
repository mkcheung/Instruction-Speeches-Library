<?php

namespace App\Models;

use Database\Factories\SpeechFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * MODERNIZATION_PLAN §6.3, §6.11. `supersedes`/`supersededBy` implement the
 * "linked to a previous attempt" chain — the DB's `< id` CHECK and the
 * partial unique index on `supersedes_id` are the real enforcement (see the
 * migration); these relations just walk what the DB already guarantees is a
 * cycle-free, at-most-one-successor chain. Cross-owner linking is NOT a DB
 * constraint (the owner lives on a different row of the same table) — that
 * lives in App\Services\SpeechService::linkSupersedes.
 *
 * `@property` block below is not decorative: the `speeches` migration is
 * raw `DB::statement` SQL (needed for a CHECK constraint and a partial
 * unique index Blueprint can't express — see the migration's own comment),
 * so Larastan's migration-AST column scanner, which reads `$table->column()`
 * calls, cannot infer this model's columns the way it does for a normal
 * Blueprint table. Without this block every property access below is an
 * "undefined property" Larastan error.
 *
 * @property int $id
 * @property string $ulid
 * @property int $user_id
 * @property string $title
 * @property string|null $description
 * @property Carbon|null $delivered_on
 * @property bool $is_example
 * @property string|null $duration_seconds
 * @property string $playback_key
 * @property int|null $supersedes_id
 * @property string|null $change_note
 * @property string|null $poster_time_seconds
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property Carbon|null $deleted_at
 */
#[Fillable(['user_id', 'title', 'description', 'delivered_on', 'supersedes_id', 'change_note', 'poster_time_seconds'])]
class Speech extends Model
{
    /** @use HasFactory<SpeechFactory> */
    use HasFactory, SoftDeletes;

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return HasMany<SpeechAsset, $this>
     */
    public function assets(): HasMany
    {
        return $this->hasMany(SpeechAsset::class);
    }

    /**
     * @return HasMany<Review, $this>
     */
    public function reviews(): HasMany
    {
        return $this->hasMany(Review::class);
    }

    /**
     * The earlier attempt this speech replaces, if any (§6.11).
     *
     * @return BelongsTo<Speech, $this>
     */
    public function supersedes(): BelongsTo
    {
        return $this->belongsTo(Speech::class, 'supersedes_id');
    }

    /**
     * The newer attempt that replaces this one, if any. At most one, per
     * the migration's `uq_speeches_successor` partial unique index.
     *
     * @return HasOne<Speech, $this>
     */
    public function supersededBy(): HasOne
    {
        return $this->hasOne(Speech::class, 'supersedes_id');
    }

    /**
     * The primary (`is_primary`) `video` asset, if one is `ready` — what
     * the player and the "my speeches" card actually render (§9.4 rule 3:
     * "`speech_assets.status` is the only playback-readiness signal").
     *
     * @return HasOne<SpeechAsset, $this>
     */
    public function primaryVideo(): HasOne
    {
        return $this->hasOne(SpeechAsset::class)
            ->where('kind', 'video')
            ->where('is_primary', true);
    }

    /**
     * MODERNIZATION_PLAN §7.3: the two-tier access rule as one query scope.
     * A speech is visible to a user if they own it, or if they hold a
     * review on it whose `status` is access-granting (Review::ACCESS_GRANTING)
     * and which has not been revoked. Deliberately does NOT include
     * `status = 'invited'` — an invitee who hasn't accepted yet gets a
     * separate, reduced-payload metadata tier (see SpeechController::show),
     * not full visibility through this scope.
     *
     * @param  Builder<Speech>  $q
     * @return Builder<Speech>
     */
    public function scopeVisibleTo(Builder $q, User $user): Builder
    {
        return $q->where(fn ($q) => $q
            ->where('speeches.user_id', $user->id)
            ->orWhereExists(fn ($s) => $s->selectRaw('1')->from('reviews')
                ->whereColumn('reviews.speech_id', 'speeches.id')
                ->where('reviews.reviewer_id', $user->id)
                ->whereIn('reviews.status', Review::ACCESS_GRANTING)
                ->whereNull('reviews.revoked_at')));
    }

    protected static function booted(): void
    {
        static::creating(function (Speech $speech): void {
            $speech->ulid ??= (string) Str::ulid();
            $speech->playback_key ??= (string) Str::uuid();
        });
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'delivered_on' => 'date',
            'is_example' => 'boolean',
            'duration_seconds' => 'decimal:3',
            'poster_time_seconds' => 'decimal:3',
        ];
    }
}
