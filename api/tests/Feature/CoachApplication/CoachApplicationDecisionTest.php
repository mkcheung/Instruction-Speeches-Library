<?php

use App\Models\AuditLog;
use App\Models\CoachApplication;
use App\Models\User;
use App\Notifications\CoachApplicationApproved;
use App\Notifications\CoachApplicationRejected;
use App\Services\CoachApplicationDecisionService;
use App\Support\AuditAction;
use Database\Seeders\RoleSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use Symfony\Component\HttpKernel\Exception\HttpException;

function decisionFixture(string $status = 'submitted'): array
{
    test()->seed(RoleSeeder::class);
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $applicant = User::factory()->create(['username' => 'applicantone']);
    $applicant->assignRole('member');
    $application = CoachApplication::query()->create(['user_id' => $applicant->id, 'status' => $status, 'statement' => 's']);

    return [$admin, $applicant, $application];
}

function decisionAuditCount(string $action): int
{
    return AuditLog::query()->where('action', $action)->count();
}

it('a stale submitted snapshot cannot reject after an approval already won', function () {
    Notification::fake();
    [$admin, $applicant, $application] = decisionFixture();
    $stale = CoachApplication::query()->findOrFail($application->id);

    app(CoachApplicationDecisionService::class)->approve($admin, $application, 'Yes.');

    expect(fn () => app(CoachApplicationDecisionService::class)->reject($admin, $stale, 'No.'))
        ->toThrow(HttpException::class);

    expect($application->fresh()->status)->toBe('approved')
        ->and($application->fresh()->decision_reason)->toBe('Yes.')
        ->and($applicant->fresh()->hasRole('coach'))->toBeTrue()
        ->and(decisionAuditCount(AuditAction::COACH_APPLICATION_REJECTED))->toBe(0);
    Notification::assertNotSentTo($applicant, CoachApplicationRejected::class);
});

it('a stale submitted snapshot cannot approve after a rejection won', function () {
    Notification::fake();
    [$admin, $applicant, $application] = decisionFixture();
    $stale = CoachApplication::query()->findOrFail($application->id);

    app(CoachApplicationDecisionService::class)->reject($admin, $application, 'No.');

    try {
        app(CoachApplicationDecisionService::class)->approve($admin, $stale, 'Yes.');
        $this->fail('expected 409');
    } catch (HttpException $e) {
        expect($e->getStatusCode())->toBe(409);
    }

    expect($application->fresh()->status)->toBe('rejected')
        ->and($applicant->fresh()->hasRole('coach'))->toBeFalse()
        ->and(decisionAuditCount(AuditAction::COACH_APPLICATION_APPROVED))->toBe(0);
    Notification::assertNotSentTo($applicant, CoachApplicationApproved::class);
});

it('repeating the same terminal decision is a no-op keeping the first reason, audit and notice', function () {
    Notification::fake();
    [$admin, $applicant, $application] = decisionFixture();
    $stale = CoachApplication::query()->findOrFail($application->id);

    app(CoachApplicationDecisionService::class)->approve($admin, $application, 'First.');
    $decidedAt = $application->fresh()->decided_at;
    $this->travel(5)->minutes();
    app(CoachApplicationDecisionService::class)->approve($admin, $stale, 'Second.');

    expect($application->fresh()->decision_reason)->toBe('First.')
        ->and($application->fresh()->decided_at)->toBe($decidedAt)
        ->and(decisionAuditCount(AuditAction::COACH_APPLICATION_APPROVED))->toBe(1)
        ->and(AuditLog::query()->where('action', AuditAction::ROLE_ASSIGNED)->count())->toBe(1);
    Notification::assertSentToTimes($applicant, CoachApplicationApproved::class, 1);
});

it('repeated rejection is a no-op', function () {
    Notification::fake();
    [$admin, $applicant, $application] = decisionFixture();

    app(CoachApplicationDecisionService::class)->reject($admin, $application, 'First.');
    app(CoachApplicationDecisionService::class)->reject($admin, CoachApplication::query()->findOrFail($application->id), 'Second.');

    expect($application->fresh()->decision_reason)->toBe('First.')
        ->and(decisionAuditCount(AuditAction::COACH_APPLICATION_REJECTED))->toBe(1);
    Notification::assertSentToTimes($applicant, CoachApplicationRejected::class, 1);
});

it('draft and withdrawn applications return a controlled 409', function (string $status) {
    Notification::fake();
    [$admin, , $application] = decisionFixture($status);

    foreach (['approve', 'reject'] as $verb) {
        try {
            app(CoachApplicationDecisionService::class)->{$verb}($admin, $application, 'x');
            $this->fail('expected 409');
        } catch (HttpException $e) {
            expect($e->getStatusCode())->toBe(409);
        }
    }
    expect($application->fresh()->status)->toBe($status);
    Notification::assertNothingSent();
})->with(['draft', 'withdrawn']);

it('reauthorizes with a fresh actor: a demoted admin cannot decide, even a duplicate', function () {
    Notification::fake();
    [$admin, $applicant, $application] = decisionFixture();
    $other = User::factory()->create();
    $other->assignRole('admin');
    $staleActor = User::query()->findOrFail($other->id);
    $staleActor->hasRole('admin'); // warm the in-memory role cache

    app(CoachApplicationDecisionService::class)->approve($admin, $application, 'Yes.');
    User::query()->findOrFail($other->id)->removeRole('admin');

    expect(fn () => app(CoachApplicationDecisionService::class)->approve($staleActor, $application, 'Again.'))
        ->toThrow(AuthorizationException::class);
    expect(fn () => app(CoachApplicationDecisionService::class)->reject($staleActor, CoachApplication::query()->findOrFail($application->id), 'x'))
        ->toThrow(AuthorizationException::class);
    expect($application->fresh()->status)->toBe('approved');
});

it('approval keeps the self-assignment 422 and rolls everything back', function () {
    Notification::fake();
    [$admin, , $application] = decisionFixture();
    $application->forceFill(['user_id' => $admin->id])->save();

    try {
        app(CoachApplicationDecisionService::class)->approve($admin, $application, 'x');
        $this->fail('expected 422');
    } catch (HttpException $e) {
        expect($e->getStatusCode())->toBe(422);
    }
    expect($application->fresh()->status)->toBe('submitted')
        ->and(decisionAuditCount(AuditAction::COACH_APPLICATION_APPROVED))->toBe(0);
    Notification::assertNothingSent();
});

it('an outer rollback suppresses the decision notice and leaves no effects', function () {
    Notification::fake();
    [$admin, $applicant, $application] = decisionFixture();

    try {
        DB::transaction(function () use ($admin, $application) {
            app(CoachApplicationDecisionService::class)->approve($admin, $application, 'Yes.');
            throw new RuntimeException('outer failure');
        });
    } catch (RuntimeException) {
    }

    expect($application->fresh()->status)->toBe('submitted')
        ->and($applicant->fresh()->hasRole('coach'))->toBeFalse();
    Notification::assertNothingSent();
});

it('the notification carries an immutable payload and the current username URL', function () {
    [$admin, $applicant, $application] = decisionFixture();
    Notification::fake();
    app(CoachApplicationDecisionService::class)->approve($admin, $application, 'Welcome.');

    Notification::assertSentTo($applicant, CoachApplicationApproved::class, function ($n) use ($application, $applicant) {
        $applicant->username = 'renamedlater';
        $data = $n->toDatabase($applicant);

        return $data['type'] === 'coach_application.approved'
            && $data['coach_application_id'] === $application->id
            && str_ends_with($data['url'], '/u/renamedlater')
            && $n->toMail($applicant)->introLines[1] === 'Welcome.';
    });
});

it('a notification enqueue failure after commit is logged and does not undo the decision', function () {
    [$admin, $applicant, $application] = decisionFixture();
    Notification::shouldReceive('send')->andThrow(new RuntimeException('queue down'));
    Notification::shouldReceive('sendNow')->andThrow(new RuntimeException('queue down'));
    Log::spy();

    app(CoachApplicationDecisionService::class)->approve($admin, $application, 'Yes.');

    expect($application->fresh()->status)->toBe('approved')
        ->and($applicant->fresh()->hasRole('coach'))->toBeTrue();
    Log::shouldHaveReceived('error')->withArgs(fn ($m, $c) => ($c['application_id'] ?? null) === $application->id);
});
