<?php

namespace App\Filament\Auth;

use App\Models\User;
use App\Support\FilamentMfaStamp;
use DanHarrin\LivewireRateLimiting\Exceptions\TooManyRequestsException;
use Filament\Actions\Action;
use Filament\Auth\MultiFactor\App\AppAuthentication;
use Filament\Facades\Filament;
use Filament\Notifications\Notification;
use Filament\Pages\SimplePage;
use Filament\Panel;
use Filament\Schemas\Components\Actions;
use Filament\Schemas\Components\Component;
use Filament\Schemas\Components\EmbeddedSchema;
use Filament\Schemas\Components\Form;
use Filament\Schemas\Concerns\RestrictsFileUploadsToSchemaComponents;
use Filament\Schemas\Schema;
use Illuminate\Contracts\Support\Htmlable;
use Illuminate\Support\Facades\RateLimiter;

/**
 * PLAN-ADMIN-LOGIN-REDIRECT.md §6.3 — the step-up challenge (Q1(b)).
 *
 * Proves a second factor for a session that is already Filament-authenticated
 * (typically an SPA session that reached the panel via the shared `web`
 * guard cookie, never via this panel's own login form). Reuses
 * `AppAuthentication::getChallengeFormComponents()` for the code input,
 * recovery-code fallback, and code-reuse prevention — only the throttling
 * is hand-rolled here, copied from `Filament\Auth\Pages\Login`'s own
 * `isMultiFactorChallengeRateLimited()` (protected there, unreachable via
 * inheritance since this page does not extend `Login`), so an unauthenticated
 * step-up page can never become an un-throttled TOTP brute-force oracle.
 *
 * ⚠️ This route is registered manually, via `AdminPanelProvider`'s
 * `authenticatedRoutes()` closure — never through `->pages()`/discoverPages().
 * A page discovered that way is routed through `Pages\Concerns\HasRoutes`,
 * which attaches `multiFactorAuthenticationRequiredMiddlewareName()`'s
 * middleware (`RequireFilamentMfaChallenge`) to every such page's route
 * whenever the panel's multi-factor authentication is required — which
 * would gate this route with the very middleware it exists to satisfy, and
 * loop. `Filament\Auth\Pages\Login` and `SetUpRequiredMultiFactorAuthentication`
 * sidestep this the same way: they extend `SimplePage`, not `Page`, and are
 * registered as plain closures in the vendor `routes/web.php`, never via
 * `Pages\Concerns\HasRoutes`.
 *
 * @property-read Schema $form
 */
class MfaChallenge extends SimplePage
{
    use RestrictsFileUploadsToSchemaComponents;

    /**
     * @var array<string, mixed>|null
     */
    public ?array $data = [];

    public static function getRouteName(Panel $panel): string
    {
        return $panel->generateRouteName('auth.multi-factor-authentication.challenge');
    }

    public function mount(): void
    {
        if (Filament::auth()->user() === null) {
            redirect()->guest(Filament::getLoginUrl() ?? '/');

            return;
        }

        $user = $this->resolveUser();

        abort_unless($user->canAccessPanel(Filament::getDefaultPanel()), 403);

        if (! $this->provider()->isEnabled($user)) {
            redirect()->intended($this->setUpRequiredUrl());

            return;
        }

        if (FilamentMfaStamp::isValid($user)) {
            redirect()->intended(Filament::getUrl());

            return;
        }

        $this->form->fill();
    }

    public function authenticate(): void
    {
        $user = $this->resolveUser();

        if ($this->isMultiFactorChallengeRateLimited($user)) {
            return;
        }

        $this->form->validate();

        FilamentMfaStamp::write($user);

        redirect()->intended(Filament::getUrl());
    }

    /**
     * Every caller here runs on an authenticated, admin-tier route
     * (`EnsureUserIsAdmin` sits ahead of this page in the panel's own
     * `authMiddleware()`, §6.6), so the guard is defensive rather than a
     * real branch — but `Filament::auth()->user()` is typed nullable and
     * merely `Authenticatable`, while `getChallengeFormComponents()`
     * needs the concrete `User` model's `HasAppAuthentication` /
     * `HasAppAuthenticationRecovery` contracts. Asserted once here rather
     * than re-derived at every call site.
     */
    protected function resolveUser(): User
    {
        $user = Filament::auth()->user();

        abort_if(! ($user instanceof User), 403);

        return $user;
    }

    /**
     * `getSetUpRequiredMultiFactorAuthenticationUrl()` is typed `?string`
     * because it is `null` whenever the panel has no MFA providers
     * configured at all — not reachable here, since this page's own route
     * is only ever registered beside a panel that has one (§6.6). Asserted
     * rather than silently coalesced, so a future panel misconfiguration
     * fails loudly instead of silently landing on `/`.
     */
    protected function setUpRequiredUrl(): string
    {
        $url = Filament::getSetUpRequiredMultiFactorAuthenticationUrl();

        abort_if($url === null, 500);

        return $url;
    }

    /**
     * Same rate-limiting key and threshold as `Login::isMultiFactorChallengeRateLimited()`
     * (`filament-multi-factor-challenge:{id}`, `maxAttempts: 5`) — the two
     * surfaces challenge the same secret, so they share one counter rather
     * than doubling an attacker's effective budget.
     */
    protected function isMultiFactorChallengeRateLimited(User $user): bool
    {
        $rateLimitingKey = "filament-multi-factor-challenge:{$user->getAuthIdentifier()}";

        if (RateLimiter::tooManyAttempts($rateLimitingKey, maxAttempts: 5)) {
            $this->getRateLimitedNotification(new TooManyRequestsException(
                static::class,
                'authenticate',
                request()->ip(),
                RateLimiter::availableIn($rateLimitingKey),
            ))?->send();

            return true;
        }

        RateLimiter::hit($rateLimitingKey);

        return false;
    }

    protected function getRateLimitedNotification(TooManyRequestsException $exception): ?Notification
    {
        return Notification::make()
            ->title(__('filament-panels::auth/pages/login.notifications.throttled.title', [
                'seconds' => $exception->secondsUntilAvailable,
                'minutes' => $exception->minutesUntilAvailable,
            ]))
            ->danger();
    }

    protected function provider(): AppAuthentication
    {
        /** @var AppAuthentication $provider */
        $provider = Filament::getMultiFactorAuthenticationProviders()['app'];

        return $provider;
    }

    public function defaultForm(Schema $schema): Schema
    {
        return $schema->statePath('data');
    }

    public function form(Schema $schema): Schema
    {
        return $schema->components(
            $this->provider()->getChallengeFormComponents($this->resolveUser()),
        );
    }

    public function content(Schema $schema): Schema
    {
        return $schema->components([
            $this->getFormContentComponent(),
        ]);
    }

    public function getFormContentComponent(): Component
    {
        return Form::make([EmbeddedSchema::make('form')])
            ->id('form')
            ->livewireSubmitHandler('authenticate')
            ->footer([
                Actions::make([$this->getAuthenticateFormAction()])
                    ->fullWidth(),
            ]);
    }

    protected function getAuthenticateFormAction(): Action
    {
        return Action::make('authenticate')
            ->label(__('filament-panels::auth/pages/login.multi_factor.form.actions.authenticate.label'))
            ->submit('authenticate');
    }

    public function getTitle(): string|Htmlable
    {
        return __('filament-panels::auth/pages/login.multi_factor.heading');
    }

    public function getHeading(): string|Htmlable|null
    {
        return __('filament-panels::auth/pages/login.multi_factor.heading');
    }

    public function getSubheading(): string|Htmlable|null
    {
        return __('filament-panels::auth/pages/login.multi_factor.subheading');
    }
}
