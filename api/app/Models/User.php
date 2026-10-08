<?php

namespace App\Models;

use App\Support\Role;
use App\Support\Username;
use Database\Factories\UserFactory;
use Filament\Auth\MultiFactor\App\Contracts\HasAppAuthentication;
use Filament\Auth\MultiFactor\App\Contracts\HasAppAuthenticationRecovery;
use Filament\Models\Contracts\FilamentUser;
use Filament\Models\Contracts\HasName;
use Filament\Panel;
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
use SensitiveParameter;
use Spatie\Permission\Traits\HasRoles;

/**
 * @property array<string,mixed> $preferences
 * @property Carbon|null $erasure_started_at
 * @property Carbon|null $anonymized_at
 * @property string|null $two_factor_secret
 * @property array<string>|null $two_factor_recovery_codes
 * @property Carbon|null $two_factor_confirmed_at
 */
#[Fillable(['name', 'first_name', 'last_name', 'email', 'password', 'preferences', 'erasure_started_at', 'anonymized_at'])]
#[Hidden(['password', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes'])]
class User extends Authenticatable implements FilamentUser, HasAppAuthentication, HasAppAuthenticationRecovery, HasName, MustVerifyEmailContract
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
            // PLAN-ADMIN-DASHBOARD.md §5.1. Both columns exist since
            // 2026_08_22_100003_add_suspended_at_to_users_table.php and
            // both were missing from this list, so every read returned a
            // raw string: `$user->suspended_at->diffForHumans()` threw,
            // and any `->isPast()`/comparison silently did string
            // arithmetic. Filament's `->dateTime()` column masked it
            // because that formatter parses strings itself, which is why
            // the panel looked fine while `App\Http\Middleware\
            // CheckUserIsActive` (the first real consumer of these two)
            // needed them to be Carbon instances.
            //
            // `deleted_at` is NOT Eloquent's soft-delete column here —
            // `User` deliberately omits the SoftDeletes trait (see the
            // migration's own docblock); it is a moderation grace stamp
            // that every query must filter on explicitly. Casting it adds
            // no global scope.
            'suspended_at' => 'datetime',
            'deleted_at' => 'datetime',
            // Fortify's own cast choices for the columns its migration
            // created, kept identical so the two never disagree about
            // what is stored: the secret is encrypted at rest, and the
            // recovery codes are an encrypted JSON array.
            'two_factor_secret' => 'encrypted',
            'two_factor_recovery_codes' => 'encrypted:array',
            'two_factor_confirmed_at' => 'datetime',
        ];
    }

    /**
     * Filament's `HasName` contract — and a genuine production bug fix,
     * not a nicety.
     *
     * `FilamentManager::getUserName()` (vendor, :614-621) is typed
     * `: string` and falls back to `$user->getAttributeValue('name')` for
     * any user that does NOT implement this interface. But STEP-01 made
     * `users.name` NULLABLE when it split identity into
     * `first_name`/`last_name`/`username`
     * (2026_08_07_004005_add_identity_columns_to_users_table.php:23), and
     * nothing on the registration path has written it since. So
     * `getUserName()` returned null from a non-nullable signature and
     * threw a TypeError while rendering the panel's own layout —
     * **every authenticated page of /control-panel 500'd for every user
     * whose `name` is null**, which in this database is 6 of them,
     * including both seeded admins.
     *
     * Not caught by any backend test, and that is the instructive part:
     * `Livewire::test()` drives a component in isolation and never
     * renders `components/layout/index.blade.php`, so 122 green panel
     * tests sat on top of a panel no human could load. §9's note that
     * "the panel has never been exercised by a browser in CI" was not a
     * coverage gap in the abstract — this is what was hiding in it, and a
     * browser found it on the first authenticated render.
     *
     * Deliberately the SAME expression `UserResource`/`PublicProfileResource`
     * already use, rather than a new one: a panel that disagreed with the
     * API about a person's name would be its own, quieter bug. Falls back
     * through display name -> first+last -> username -> email so the
     * return is always a non-empty string, which the signature requires.
     */
    public function getFilamentName(): string
    {
        $displayName = $this->profile?->display_name
            ?: trim("{$this->first_name} {$this->last_name}");

        return $displayName !== '' ? $displayName : ($this->username ?? $this->email);
    }

    /**
     * Filament's `FilamentUser` contract, and the second production bug in
     * this pair — the larger of the two.
     *
     * `Filament\Http\Middleware\Authenticate::authenticate()` ends in
     *
     *     abort_if($user instanceof FilamentUser
     *         ? (! $user->canAccessPanel($panel))
     *         : (config('app.env') !== 'local'), 403)
     *
     * so a `User` that does NOT implement this interface makes that an
     * **unconditional 403 on every authenticated panel route outside
     * `APP_ENV=local`** — for admins and super_admins alike. That is
     * every deployed environment: `compose.e2e.yaml` sets `APP_ENV: e2e`
     * and production sets `production`. The dev stack (`api/.env`,
     * `APP_ENV=local`) was the only place `/control-panel` had ever been
     * opened, which is why the whole panel could be built, tested and
     * browsed while being unreachable everywhere it matters.
     *
     * `EnsureUserIsAdmin`'s docblock argued against implementing this
     * interface because `User.php` is loaded on every request while
     * `filament/filament` "isn't installed yet". That reasoning expired:
     * the package is installed, and this class already imports
     * `HasAppAuthentication`, `HasAppAuthenticationRecovery` and `HasName`
     * from it, so the dependency it was protecting against is three
     * `use` statements above this one.
     *
     * The predicate is deliberately IDENTICAL to `EnsureUserIsAdmin`'s —
     * `Role::ADMIN_TIER`, per §5.2 — so the two layers can never disagree
     * about who may enter the panel. `$panel` is unused because there is
     * exactly one panel (`->id('admin')`); a second panel would branch on
     * `$panel->getId()` here.
     */
    public function canAccessPanel(Panel $panel): bool
    {
        return $this->hasAnyRole(Role::ADMIN_TIER);
    }

    /**
     * Filament's TOTP multi-factor contract (STEP-12-FROZEN-CONTRACT.md
     * §11 — `AdminPanelProvider` declares `multiFactorAuthentication(...,
     * isRequired: true)`). Filament ships the TOTP arithmetic but is
     * deliberately storage-agnostic, so these five methods are the whole
     * of what it needs from us: where the secret lives, and how to label
     * it in the user's authenticator app.
     *
     * Mapped onto the `two_factor_secret` / `two_factor_recovery_codes` /
     * `two_factor_confirmed_at` columns Fortify's migration already
     * created and nothing else reads — an adapter between two packages
     * implementing the same feature under different method names, not a
     * new storage scheme. No migration needed.
     *
     * `EnsureUserIsAdmin`'s docblock argued against implementing a
     * Filament interface here, on the grounds that `User` loads on every
     * request while `filament/filament` might not be installed. That
     * concern is now obsolete: Filament is a `require` (not
     * `require-dev`) dependency, so it is in the `--no-dev` production
     * image too.
     */
    public function getAppAuthenticationSecret(): ?string
    {
        return $this->two_factor_secret;
    }

    /**
     * Filament reads "has a secret" as "is enrolled"
     * (`AppAuthentication::isEnabled()` is `filled($secret)`), whereas
     * Fortify's flow is two-phase and treats `two_factor_confirmed_at`
     * as the real enrollment marker. Setting both together keeps that
     * column truthful rather than leaving it a third piece of state
     * nobody maintains — Filament only calls this AFTER the user has
     * proven a valid code, so "secret saved" really does mean
     * "confirmed" on this path.
     */
    public function saveAppAuthenticationSecret(#[SensitiveParameter] ?string $secret): void
    {
        $this->forceFill([
            'two_factor_secret' => $secret,
            'two_factor_confirmed_at' => $secret === null ? null : now(),
        ])->save();
    }

    /** The label under the brand name in the user's authenticator app. */
    public function getAppAuthenticationHolderName(): string
    {
        return $this->email;
    }

    /**
     * Recovery codes are what stop `isRequired: true` being a one-way
     * door: role management lives INSIDE the panel, so an admin who
     * loses their phone cannot be restored unless another admin already
     * exists. `RoleAssignmentService` guarantees an admin ROW survives;
     * it cannot guarantee anyone can still authenticate as one.
     *
     * @return ?array<string>
     */
    public function getAppAuthenticationRecoveryCodes(): ?array
    {
        return $this->two_factor_recovery_codes;
    }

    /**
     * @param  ?array<string>  $codes
     */
    public function saveAppAuthenticationRecoveryCodes(#[SensitiveParameter] ?array $codes): void
    {
        $this->forceFill(['two_factor_recovery_codes' => $codes])->save();
    }
}
