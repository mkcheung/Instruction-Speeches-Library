<?php

namespace App\Providers;

use App\Actions\Fortify\CreateNewUser;
use App\Actions\Fortify\ResetUserPassword;
use App\Actions\Fortify\UpdateUserPassword;
use App\Actions\Fortify\UpdateUserProfileInformation;
use App\Http\Responses\Fortify as FortifyResponses;
use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Laravel\Fortify\Actions\RedirectIfTwoFactorAuthenticatable;
use Laravel\Fortify\Contracts as FortifyContracts;
use Laravel\Fortify\Fortify;

class FortifyServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     *
     * Headless Fortify ships no response implementations of its own for a
     * JSON-only consumer beyond its `wantsJson()` fallbacks — every contract
     * below is hand-bound per STEP-01-identity.md, rather than trusted to
     * the framework default.
     */
    public function register(): void
    {
        $this->app->singleton(FortifyContracts\LoginResponse::class, FortifyResponses\LoginResponse::class);
        $this->app->singleton(FortifyContracts\RegisterResponse::class, FortifyResponses\RegisterResponse::class);
        $this->app->singleton(FortifyContracts\LogoutResponse::class, FortifyResponses\LogoutResponse::class);
        $this->app->bind(FortifyContracts\SuccessfulPasswordResetLinkRequestResponse::class, FortifyResponses\SuccessfulPasswordResetLinkRequestResponse::class);
        $this->app->bind(FortifyContracts\FailedPasswordResetLinkRequestResponse::class, FortifyResponses\FailedPasswordResetLinkRequestResponse::class);
        $this->app->bind(FortifyContracts\PasswordResetResponse::class, FortifyResponses\PasswordResetResponse::class);
        $this->app->bind(FortifyContracts\FailedPasswordResetResponse::class, FortifyResponses\FailedPasswordResetResponse::class);
        $this->app->singleton(FortifyContracts\VerifyEmailResponse::class, FortifyResponses\VerifyEmailResponse::class);
        $this->app->singleton(FortifyContracts\EmailVerificationNotificationSentResponse::class, FortifyResponses\EmailVerificationNotificationSentResponse::class);
        $this->app->singleton(FortifyContracts\PasswordUpdateResponse::class, FortifyResponses\PasswordUpdateResponse::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Fortify::createUsersUsing(CreateNewUser::class);
        Fortify::updateUserProfileInformationUsing(UpdateUserProfileInformation::class);
        Fortify::updateUserPasswordsUsing(UpdateUserPassword::class);
        Fortify::resetUserPasswordsUsing(ResetUserPassword::class);
        Fortify::redirectUserForTwoFactorAuthenticationUsing(RedirectIfTwoFactorAuthenticatable::class);

        // code-review finding (2026-10-10), surfaced by
        // PLAN-ADMIN-LOGIN-REDIRECT.md's Phase 2: without this, a
        // suspended/deleted/anonymized user's password still succeeds at
        // `POST /login` — `CheckUserIsActive` only evicts on the NEXT
        // authenticated request, since `$request->user()` resolves `null`
        // during the login request itself. `LoginResponse` then returns
        // 200 with `roles` in the body for an account that is about to be
        // evicted. Before Phase 2 that was a latent one-response window;
        // after it, `getPostLoginDestination()` reads those `roles` and
        // can fire a real cross-origin `window.location.replace()` to the
        // admin panel for a SUSPENDED admin, stranding them on a bare
        // Blade page with no Back. Rejecting the credential here — at
        // authentication, not just at the next request — closes the
        // underlying gap rather than only the symptom, and applies
        // uniformly (not just to admins), matching `CheckUserIsActive`'s
        // own three terminal-for-access states.
        Fortify::authenticateUsing(function (Request $request) {
            $user = User::where('email', $request->input('email'))->first();

            if (! $user || ! Hash::check((string) $request->input('password'), $user->password)) {
                return null;
            }

            if ($user->suspended_at !== null || $user->deleted_at !== null || $user->anonymized_at !== null) {
                return null;
            }

            return $user;
        });

        // Headless Fortify (`config('fortify.views') === false`) never
        // registers the `password.reset` named route — that route only
        // exists to serve Fortify's own Blade view. The reset page lives in
        // the React frontend instead, so the notification's link must be
        // built by hand, same as `VerifyEmailResponse` already does for the
        // verification link.
        ResetPassword::createUrlUsing(function ($notifiable, string $token) {
            $email = urlencode($notifiable->getEmailForPasswordReset());

            return rtrim(config('app.frontend_url'), '/')."/reset-password/{$token}?email={$email}";
        });

        RateLimiter::for('login', function (Request $request) {
            $throttleKey = Str::transliterate(Str::lower($request->input(Fortify::username())).'|'.$request->ip());

            return Limit::perMinute(5)->by($throttleKey);
        });

        RateLimiter::for('two-factor', function (Request $request) {
            return Limit::perMinute(5)->by($request->session()->get('login.id'));
        });

        RateLimiter::for('passkeys', function (Request $request) {
            $credentialId = $request->input('credential.id');

            return Limit::perMinute(10)->by(
                ($credentialId ?: $request->session()->getId()).'|'.$request->ip()
            );
        });
    }
}
