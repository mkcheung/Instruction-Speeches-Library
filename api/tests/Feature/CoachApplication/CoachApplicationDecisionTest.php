<?php

use App\Models\ApplicationDocument;
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

/**
 * By default the application holds one clean document, which approval
 * requires (PLAN-COACH-APPLICATION-REVIEW-PAGE.md §7). The guard reads DB
 * rows only, so no bytes are stored.
 */
function decisionFixture(string $status = 'submitted', bool $withCleanDocument = true): array
{
    test()->seed(RoleSeeder::class);
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $applicant = User::factory()->create(['username' => 'applicantone']);
    $applicant->assignRole('member');
    $application = CoachApplication::query()->create(['user_id' => $applicant->id, 'status' => $status, 'statement' => 's']);

    if ($withCleanDocument) {
        decisionDocument($application, 'clean');
    }

    return [$admin, $applicant, $application];
}

function decisionDocument(CoachApplication $application, string $status, string $path = 'applications/x/doc.pdf'): ApplicationDocument
{
    return ApplicationDocument::query()->create([
        'application_id' => $application->id,
        'disk' => 'application_documents',
        'path' => $path,
        'original_filename' => 'cert.pdf',
        'byte_size' => 1234,
        'sha256' => str_repeat('a', 64),
        'status' => $status,
    ]);
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

it('approval without a clean document is a 409 with no status change, role or audit', function (array $documents) {
    Notification::fake();
    [$admin, $applicant, $application] = decisionFixture(withCleanDocument: false);
    foreach ($documents as $i => [$status, $path]) {
        decisionDocument($application, $status, $path ?? "applications/x/{$i}.pdf");
    }

    try {
        app(CoachApplicationDecisionService::class)->approve($admin, $application, 'Yes.');
        $this->fail('expected 409');
    } catch (HttpException $e) {
        expect($e->getStatusCode())->toBe(409)
            ->and($e->getMessage())->toContain('without at least one clean document');
    }

    expect($application->fresh()->status)->toBe('submitted')
        ->and($applicant->fresh()->hasRole('coach'))->toBeFalse()
        ->and(decisionAuditCount(AuditAction::COACH_APPLICATION_APPROVED))->toBe(0)
        ->and(AuditLog::query()->where('action', AuditAction::ROLE_ASSIGNED)->count())->toBe(0);
    Notification::assertNothingSent();
})->with([
    'no documents' => [[]],
    'only non-clean documents' => [[['pending_scan', null], ['infected', null], ['clean', '']]],
]);

it('approval with one clean document among non-clean ones succeeds', function () {
    Notification::fake();
    [$admin, $applicant, $application] = decisionFixture(withCleanDocument: false);
    decisionDocument($application, 'pending_scan', 'applications/x/pending.pdf');
    decisionDocument($application, 'clean', 'applications/x/clean.pdf');

    app(CoachApplicationDecisionService::class)->approve($admin, $application, 'Yes.');

    expect($application->status)->toBe('approved')
        ->and($applicant->fresh()->hasRole('coach'))->toBeTrue();
});

it('rejection needs no documents', function () {
    Notification::fake();
    [$admin, , $application] = decisionFixture(withCleanDocument: false);

    app(CoachApplicationDecisionService::class)->reject($admin, $application, 'No.');

    expect($application->status)->toBe('rejected')
        ->and(decisionAuditCount(AuditAction::COACH_APPLICATION_REJECTED))->toBe(1);
});

it('approval is a 409 once the applicant\'s erasure has started, while rejection still works', function () {
    Notification::fake();
    [$admin, $applicant, $application] = decisionFixture();
    $applicant->forceFill(['erasure_started_at' => now()])->save();

    try {
        app(CoachApplicationDecisionService::class)->approve($admin, $application, 'Yes.');
        $this->fail('expected 409');
    } catch (HttpException $e) {
        expect($e->getStatusCode())->toBe(409)
            ->and($e->getMessage())->toBe('The applicant is erasing their account.');
    }

    expect($application->fresh()->status)->toBe('submitted')
        ->and($applicant->fresh()->hasRole('coach'))->toBeFalse()
        ->and(decisionAuditCount(AuditAction::COACH_APPLICATION_APPROVED))->toBe(0);

    app(CoachApplicationDecisionService::class)->reject($admin, $application, 'No.');
    expect($application->fresh()->status)->toBe('rejected');
});
