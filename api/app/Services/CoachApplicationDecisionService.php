<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\CoachApplication;
use App\Models\User;
use App\Notifications\CoachApplicationApproved;
use App\Notifications\CoachApplicationRejected;
use App\Support\AuditAction;
use Illuminate\Support\Facades\DB;

/**
 * STEP-12-FROZEN-CONTRACT.md §3: the ONE place a coach application is
 * approved or rejected — used by both the (future) admin API surface and
 * every Filament action, so "coach approval routes through
 * RoleAssignmentService::assign(), never a direct assignRole()" holds no
 * matter which UI triggers it (per §7.4's own warning that Filament bulk
 * actions bypass policies if a Filament action class calls
 * assignRole()/delete() directly).
 */
class CoachApplicationDecisionService
{
    public function __construct(private readonly RoleAssignmentService $roles) {}

    public function approve(User $admin, CoachApplication $application, ?string $reason = null): void
    {
        DB::transaction(function () use ($admin, $application, $reason) {
            $application->approve($admin, $reason);
            $this->roles->assign($admin, $application->user, 'coach');

            AuditLog::query()->create([
                'actor_id' => $admin->id,
                'action' => AuditAction::COACH_APPLICATION_APPROVED,
                'subject_type' => CoachApplication::class,
                'subject_id' => $application->id,
                'metadata' => ['applicant_id' => $application->user_id, 'reason' => $reason],
                'created_at' => now(),
            ]);
        });

        $application->user->notify(new CoachApplicationApproved($application));
    }

    public function reject(User $admin, CoachApplication $application, ?string $reason = null): void
    {
        DB::transaction(function () use ($admin, $application, $reason) {
            $application->reject($admin, $reason);

            AuditLog::query()->create([
                'actor_id' => $admin->id,
                'action' => AuditAction::COACH_APPLICATION_REJECTED,
                'subject_type' => CoachApplication::class,
                'subject_id' => $application->id,
                'metadata' => ['applicant_id' => $application->user_id, 'reason' => $reason],
                'created_at' => now(),
            ]);
        });

        $application->user->notify(new CoachApplicationRejected($application));
    }
}
