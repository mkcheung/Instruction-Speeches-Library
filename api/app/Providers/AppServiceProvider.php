<?php

namespace App\Providers;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // From the first model onward (§21/S1 acceptance) — surfaces N+1s
        // as exceptions in dev/test rather than silent extra queries, and
        // is off in production so a missed eager-load degrades rather than
        // 500s for a real user.
        Model::preventLazyLoading(! $this->app->isProduction());

        // Admin's override is a SCOPED Gate::before, not a blanket one
        // (§7.2) — a blanket hook would bypass the very policies Admin must
        // NOT have, e.g. reviewing. Written now, before any concrete
        // policies exist, so later steps extend $mustFallThrough instead of
        // having to remember to retrofit this hook (revision 2's mistake,
        // per the plan: it omitted `user.delete` and let a destructive
        // admin action skip its safeguards entirely).
        Gate::before(function (User $user, string $ability) {
            if (! $user->hasRole('admin')) {
                return null;
            }

            static $mustFallThrough = [
                'review.accept', 'review.decline', 'review.publish',   // coaching is an act
                'annotation.create', 'annotation.update',
                'user.delete', 'user.erase', 'user.demote',            // destructive identity ops
                'role.grantSuperAdmin', 'role.revokeSuperAdmin',
            ];

            return in_array($ability, $mustFallThrough, true) ? null : true;
        });
    }
}
