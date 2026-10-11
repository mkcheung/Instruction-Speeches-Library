<?php

namespace App\Actions\Fortify;

use App\Models\AuditLog;
use App\Models\User;
use App\Support\AuditAction;
use App\Support\Role;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Contracts\CreatesNewUsers;

class CreateNewUser implements CreatesNewUsers
{
    use PasswordValidationRules;

    /**
     * Validate and create a newly registered user.
     *
     * Registration deliberately collects only email + password — names and
     * username are gathered at onboarding step 1 (STEP-01-identity.md), not
     * here, so `first_name`/`last_name`/`username` stay nullable on `users`
     * until then.
     *
     * @param  array<string, string>  $input
     *
     * @throws ValidationException
     */
    public function create(array $input): User
    {
        Validator::make($input, [
            'email' => [
                'required',
                'string',
                'email',
                'max:255',
                Rule::unique(User::class),
            ],
            'password' => $this->passwordRules(),
        ])->validate();

        // Transactional: `RoleAssignmentService::assign()` cannot be used
        // here — its self-check (`abort_if($actor->id === $target->id,
        // 422, ...)`, RoleAssignmentService.php:101-105) would always trip
        // for a registration, since the user being created IS the only
        // party, with no distinct admin actor to pass. This is therefore
        // a deliberate, narrow exception to the service's own "ONLY legal
        // way any role assignment happens" claim — not, as an earlier
        // version of this comment wrongly claimed, the same case
        // `CoachApplicationDecisionService` is in. That service calls
        // `RoleAssignmentService::assign($admin, ...)` with a real admin
        // actor (CoachApplicationDecisionService.php:30); it is the
        // compliant pattern, not a second exemption.
        //
        // Wrapped in a transaction so a missing/renamed `member` role
        // (RoleDoesNotExist) rolls the user row back instead of leaving a
        // half-registered account that permanently occupies this email
        // address under `Rule::unique(User::class)` above, with no
        // retriable path once the role is fixed.
        return DB::transaction(function () use ($input) {
            $user = User::create([
                'email' => $input['email'],
                'password' => Hash::make($input['password']),
            ]);

            $user->assignRole(Role::MEMBER);

            // `RoleAssignmentService::assign()` writes this same row shape
            // (AuditAction::ROLE_ASSIGNED) for every OTHER role grant in
            // the product; writing it here too, with `actor_id: null`
            // (the column is nullable, audit_log migration — an entry
            // must survive the actor's account being erased, so a grant
            // with no human actor at all is the same shape, not a special
            // case), keeps every `member` grant in this now-highest-volume
            // path from being invisible to that one audit trail.
            AuditLog::query()->create([
                'actor_id' => null,
                'action' => AuditAction::ROLE_ASSIGNED,
                'subject_type' => User::class,
                'subject_id' => $user->id,
                'metadata' => ['role' => Role::MEMBER],
                'created_at' => now(),
            ]);

            return $user;
        });
    }
}
