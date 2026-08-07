<?php

namespace Database\Seeders;

use App\Models\ReservedUsername;
use App\Support\Username;
use Illuminate\Database\Seeder;

/**
 * Data, not a constant (§6.5, STEP-01 acceptance list) — grows without a
 * deploy. The SPA-route block below is transcribed directly from
 * web/src/App.tsx's <Routes> (the frontend half of this step, built
 * concurrently) rather than guessed — every top-level path segment
 * registered there as of this writing: `/`, `/register`, `/login`,
 * `/forgot-password`, `/reset-password/:token`, `/verify`, `/onboarding`,
 * `/profile`, `/u/:username`. Keep this in sync when a new top-level route
 * is added there.
 */
class ReservedUsernameSeeder extends Seeder
{
    public function run(): void
    {
        $reserved = [
            // §6.5's literal example list
            'admin', 'api', 'root', 'support', 'help', 'settings', 'login', 'me', 'new', 'static', 'assets',

            // Top-level SPA routes, transcribed from web/src/App.tsx's
            // <Routes> — 'u' for the /u/:username prefix, 'spikes' for the
            // dev-only /__spikes panel (with and without underscores, since
            // the reserved-username charset doesn't allow "_" at the start).
            'home', 'register', 'login', 'forgot-password', 'reset-password',
            'verify', 'onboarding', 'profile', 'u', 'spikes', 'not-found',
        ];

        foreach (array_unique($reserved) as $username) {
            ReservedUsername::query()->firstOrCreate(['username' => Username::normalize($username)]);
        }
    }
}
