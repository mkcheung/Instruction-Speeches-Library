<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\CoachApplication;
use App\Models\User;
use App\Notifications\CoachApplicationApproved;
use App\Notifications\CoachApplicationRejected;
use App\Support\AuditAction;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * STEP-12-FROZEN-CONTRACT.md §3: the ONE place a coach application is
 * approved or rejected — used by both the (future) admin API surface and
 * every Filament action, so "coach approval routes through
 * RoleAssignmentService::assign(), never a direct assignRole()" holds no
 * matter which UI triggers it.
 *
 * PLAN-CODE-REVIEW-FOLLOW-UP.md §8.2 (R5). Lock order: `admin_roster` ->
 * fresh applicant user -> addressed application -> role/audit writes. The
 * passed models are only addresses (IDs); every decision is made on the
 * freshly locked rows, so a stale snapshot cannot authorize a second terminal
 * transition. One terminal winner: repeating the winning decision is a no-op
 * (first reason/time kept, no new role/audit/notice); the opposite decision,
 * a draft or a withdrawn application is a controlled 409.
 *
 * `role.assign` is re-authorized here against the freshly read actor and the
 * locked applicant (callers' earlier Gate check may be stale after the roster
 * lock wait). Winner notifications are registered with DB::afterCommit so a
 * rollback, at any nesting depth, sends none; a delivery failure is logged
 * with the committed decision's identity and never reruns decision effects.
 * SQLite cannot demonstrate row/advisory lock behavior.
 */
class CoachApplicationDecisionService
{
    public function __construct(private readonly RoleAssignmentService $roles) {}

    public function approve(User $admin, CoachApplication $application, ?string $reason = null): void
    {
        $this->decide('approved', $admin, $application, $reason);
    }

    public function reject(User $admin, CoachApplication $application, ?string $reason = null): void
    {
        $this->decide('rejected', $admin, $application, $reason);
    }

    private function decide(string $outcome, User $admin, CoachApplication $application, ?string $reason): void
    {
        DB::transaction(function () use ($outcome, $admin, $application, $reason): void {
            $this->roles->acquireAdminRosterLock();

            // Fresh actor (roles read after the roster wait), no actor-row lock.
            $actor = User::query()->findOrFail($admin->id);
            $applicant = User::query()->whereKey($application->user_id)->lockForUpdate()->firstOrFail();
            $locked = CoachApplication::query()->whereKey($application->id)->lockForUpdate()->firstOrFail();

            Gate::forUser($actor)->authorize('role.assign', $applicant);

            if ($locked->status === $outcome) {
                return;
            }

            abort_unless(
                in_array($locked->status, ['submitted', 'under_review'], true),
                Response::HTTP_CONFLICT,
                "CoachApplication#{$locked->id}: cannot be {$outcome} from status \"{$locked->status}\".",
            );

            if ($outcome === 'approved') {
                $locked->approve($actor, $reason);
                $this->roles->assign($actor, $applicant, 'coach');
            } else {
                $locked->reject($actor, $reason);
            }

            AuditLog::query()->create([
                'actor_id' => $actor->id,
                'action' => $outcome === 'approved' ? AuditAction::COACH_APPLICATION_APPROVED : AuditAction::COACH_APPLICATION_REJECTED,
                'subject_type' => CoachApplication::class,
                'subject_id' => $locked->id,
                'metadata' => ['applicant_id' => $locked->user_id, 'reason' => $reason],
                'created_at' => now(),
            ]);

            $applicationId = $locked->id;
            $applicantId = $applicant->id;
            $actorId = $actor->id;

            DB::afterCommit(function () use ($outcome, $applicationId, $applicantId, $actorId, $reason): void {
                try {
                    $notice = $outcome === 'approved'
                        ? new CoachApplicationApproved($applicationId, $reason)
                        : new CoachApplicationRejected($applicationId, $reason);
                    User::query()->findOrFail($applicantId)->notify($notice);
                } catch (Throwable $e) {
                    Log::error('CoachApplicationDecisionService: decision committed but its notification failed; replay only the notice.', [
                        'application_id' => $applicationId,
                        'outcome' => $outcome,
                        'applicant_id' => $applicantId,
                        'actor_id' => $actorId,
                        'exception' => $e->getMessage(),
                    ]);
                }
            });
        });

        // Keep a caller-held model in step with the committed winner.
        $application->setRawAttributes(
            CoachApplication::query()->whereKey($application->id)->firstOrFail()->getAttributes(),
            true,
        );
    }
}
