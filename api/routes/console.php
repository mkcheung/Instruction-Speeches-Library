<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// §9.2: "the highest-value ops job in the system" — see MediaReconcileCommand.
//
// STEP-09-VERIFICATION-PLAN.md §4.1 / §7: "In APP_ENV=e2e only, the same
// schedule runs every minute" so a bounded <=90s CI service-level smoke
// (the scheduler-smoke row in §7) can actually observe a real transition,
// without changing production's cadence. `APP_ENV` is read once here at
// schedule-registration time — this file is re-evaluated on every
// `schedule:run`/`schedule:work` tick, so there is no stale-env risk from
// caching it once at boot.
if (app()->environment('e2e')) {
    Schedule::command('media:reconcile')->everyMinute();
} else {
    Schedule::command('media:reconcile')->daily();
}
