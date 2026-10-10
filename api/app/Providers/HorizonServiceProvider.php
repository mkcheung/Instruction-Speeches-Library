<?php

namespace App\Providers;

use App\Support\Role;
use Illuminate\Support\Facades\Gate;
use Laravel\Horizon\Horizon;
use Laravel\Horizon\HorizonApplicationServiceProvider;

class HorizonServiceProvider extends HorizonApplicationServiceProvider
{
    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        parent::boot();

        // Horizon::routeSmsNotificationsTo('15556667777');
        // Horizon::routeMailNotificationsTo('example@example.com');
        // Horizon::routeSlackNotificationsTo('slack-webhook-url', '#channel');
    }

    /**
     * Register the Horizon gate.
     *
     * This gate determines who can access Horizon in non-local environments.
     *
     * STEP-14-deploy-hardening.md: same role check as
     * App\Http\Middleware\EnsureUserIsAdmin (the Filament `/control-panel`
     * gate) — `admin` OR `super_admin`, since `super_admin` is a strict
     * superset of `admin`'s privileges (MODERNIZATION_PLAN §7.4) and roles
     * here are mutually exclusive (never stacked), so a bare `hasRole
     * ('admin')` would lock a super_admin-only account out of Horizon the
     * same way EnsureUserIsAdmin's docblock describes for the Filament
     * panel.
     */
    protected function gate(): void
    {
        Gate::define('viewHorizon', function ($user = null) {
            return $user !== null && $user->hasAnyRole(Role::ADMIN_TIER);
        });
    }
}
