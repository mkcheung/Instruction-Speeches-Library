<?php

namespace App\Models;

use App\Support\Username;
use Database\Factories\UserFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail as MustVerifyEmailContract;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Spatie\Permission\Traits\HasRoles;

#[Fillable(['name', 'first_name', 'last_name', 'email', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable implements MustVerifyEmailContract
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasRoles, Notifiable;

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
        ];
    }
}
