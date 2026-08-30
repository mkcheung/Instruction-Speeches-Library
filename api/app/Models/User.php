<?php

namespace App\Models;

use App\Support\Username;
use Database\Factories\UserFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail as MustVerifyEmailContract;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\HasApiTokens;
use Spatie\Permission\Traits\HasRoles;

/**
 * @property array<string,mixed> $preferences
 * @property Carbon|null $erasure_started_at
 * @property Carbon|null $anonymized_at
 */
#[Fillable(['name', 'first_name', 'last_name', 'email', 'password', 'preferences', 'erasure_started_at', 'anonymized_at'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable implements MustVerifyEmailContract
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasRoles, Notifiable;

    /** @var array<string, mixed> */
    protected $attributes = ['preferences' => '{}'];

    /**
     * @return HasOne<Profile, $this>
     */
    public function profile(): HasOne
    {
        return $this->hasOne(Profile::class);
    }

    /**
     * @return HasMany<Speech, $this>
     */
    public function speeches(): HasMany
    {
        return $this->hasMany(Speech::class);
    }

    /**
     * Every user gets an (initially empty) `profiles` row the moment the
     * account exists — resumable onboarding (§6.5) treats a partially
     * populated row as the normal state, not something created lazily on
     * first write. Covers both Fortify registration and E2ESeeder.
     */
    protected static function booted(): void
    {
        static::created(function (User $user): void {
            Profile::query()->firstOrCreate(['user_id' => $user->id]);
        });
    }

    /**
     * MODERNIZATION_PLAN §6.3/§7.1: the reviewer directory query — the only
     * discovery mechanism for picking a reviewer, deliberately restricted
     * to `member`/`coach` roles. An Admin/`super_admin` must NEVER appear
     * here, categorically (§7.1: an Admin is never a reviewer), regardless
     * of any other filter the caller passes.
     *
     * @param  Builder<User>  $query
     * @return Builder<User>
     */
    public function scopeReviewerCandidates(Builder $query, ?string $search = null, ?string $credential = null): Builder
    {
        $query->role(['member', 'coach']);

        if ($search !== null && $search !== '') {
            $like = '%'.str_replace(['%', '_'], ['\\%', '\\_'], $search).'%';
            $query->where(function (Builder $q) use ($like) {
                $q->where('first_name', 'like', $like)
                    ->orWhere('last_name', 'like', $like)
                    ->orWhere('username', 'like', $like);
            });
        }

        if ($credential !== null && $credential !== '' && in_array($credential, ['member', 'coach'], true)) {
            $query->role($credential);
        }

        return $query;
    }

    /**
     * Normalized on write so what is compared and what is displayed can
     * never drift (§6.5) — App\Support\Username is the single place the
     * case/accent-folding rule lives.
     *
     * @param  string|null  $value
     */
    public function setUsernameAttribute($value): void
    {
        $this->attributes['username'] = $value === null
            ? null
            : Username::normalize($value);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'username_changed_at' => 'datetime',
            'password' => 'hashed',
            'preferences' => 'array',
            'erasure_started_at' => 'datetime',
            // STEP-11-FROZEN-CONTRACT.md §3/§6 step 7: set once, by
            // App\Services\Privacy\AccountErasureService, when the full
            // account-erasure job anonymizes this row. Distinct from
            // `erasure_started_at` above, which only ever gates the
            // narrower reviewer-voice-note erasure slice
            // (App\Jobs\EraseSelfAccount, pre-existing).
            'anonymized_at' => 'datetime',
        ];
    }
}
