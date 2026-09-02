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

// STEP-11-privacy-erasure.md's retention-lifecycle bullet — see
// PurgeExpiredExportsCommand's docblock. Same e2e-fast/production-slow
// split as media:reconcile, for the same reason.
if (app()->environment('e2e')) {
    Schedule::command('privacy:purge-expired-exports')->everyMinute();
} else {
    Schedule::command('privacy:purge-expired-exports')->daily();
}

// STEP-12-FROZEN-CONTRACT.md §5 / STEP-12.md "Retention" — certification
// documents purged 90 days after a coach-application decision. Same
// e2e-fast/production-slow split as the two commands above, for the same
// reason.
if (app()->environment('e2e')) {
    Schedule::command('coach:purge-expired-documents')->everyMinute();
} else {
    Schedule::command('coach:purge-expired-documents')->daily();
}

// STEP-13-FROZEN-CONTRACT.md §7 / MODERNIZATION_PLAN §6.7.2: the nightly
// `connections` asymmetry reconciler. Same e2e-fast/production-slow split
// as the three commands above, for the same reason.
if (app()->environment('e2e')) {
    Schedule::command('connections:reconcile-asymmetry')->everyMinute();
} else {
    Schedule::command('connections:reconcile-asymmetry')->daily();
}
