<?php

use App\Filament\Resources\CoachApplicationResource;
use App\Filament\Resources\CoachApplicationResource\Pages\ManageCoachApplications;
use App\Filament\Resources\CoachApplicationResource\Pages\ViewCoachApplication;
use App\Models\ApplicationDocument;
use App\Models\AuditLog;
use App\Models\CoachApplication;
use App\Models\User;
use App\Services\CoachApplicationDecisionService;
use App\Support\AuditAction;
use App\Support\Role;
use Database\Seeders\RoleSeeder;
use Filament\Actions\Testing\TestAction;
use Filament\Facades\Filament;
use Filament\Infolists\Components\RepeatableEntry;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Livewire\Livewire;

require_once __DIR__.'/PanelHelpers.php';

/**
 * PLAN-COACH-APPLICATION-REVIEW-PAGE.md §11 tests 1-6 and 9, plus test 11's
 * review-page cases: the coach application list and its review page
 * (`ViewCoachApplication`).
 *
 * Every approve that is expected to SUCCEED attaches a clean document
 * (status `clean`, non-empty path) to an applicant with a null
 * `erasure_started_at`: the decision service 409s otherwise (§7, §9).
 *
 * Erased-applicant states are built by hand — `anonymized_at` set, the
 * application `withdrawn` with a null statement, the document blanked to
 * `path = ''` + `ApplicationDocument::ERASED_FILENAME` — so this file does
 * not depend on the erasure service.
 *
 * Hole 3 (approve / reject authorize inside the closure) and hole 7's
 * second instance (audit on open, not on submit) moved here from
 * `PanelModerationTest` together with the actions they pin (§10).
 */
beforeEach(function () {
    $this->seed(RoleSeeder::class);
    Filament::setCurrentPanel('admin');
    renderPanelTablesWithoutIntl();
    Storage::fake('application_documents');
});

/** @param array<string, mixed> $attributes */
function reviewApplication(User $applicant, string $status = 'submitted', array $attributes = []): CoachApplication
{
    $application = CoachApplication::query()->create([
        'user_id' => $applicant->id,
        'status' => 'draft',
        'statement' => 'Fifteen years of competitive speaking.',
    ]);

    $application->forceFill(array_merge([
        'status' => $status,
        'submitted_at' => $status === 'draft' ? null : now(),
        'decided_at' => in_array($status, ['approved', 'rejected'], true) ? now() : null,
    ], $attributes))->save();

    return $application;
}

/**
 * A document row in any §2.5 state. With `$withBytes`, the file is on the
 * faked disk, so the Download action's `fileExists` passes.
 *
 * @param  array<string, mixed>  $attributes
 */
function reviewDocument(CoachApplication $application, array $attributes = [], bool $withBytes = true): ApplicationDocument
{
    $document = new ApplicationDocument;
    $document->forceFill(array_merge([
        'application_id' => $application->id,
        'disk' => 'application_documents',
        'path' => 'applications/'.$application->id.'/'.Str::uuid().'.pdf',
        'original_filename' => 'certificate.pdf',
        'byte_size' => 2048,
        'sha256' => str_repeat('a', 64),
        'status' => 'clean',
    ], $attributes))->save();

    if ($withBytes && $document->path !== '') {
        Storage::disk('application_documents')->put($document->path, '%PDF-1.4 fake');
    }

    return $document;
}

function reviewPage(User $actor, CoachApplication $application): mixed
{
    return Livewire::actingAs($actor)->test(ViewCoachApplication::class, ['record' => $application->getKey()]);
}

// ---------------------------------------------------------------------
// Test 1 — access
// ---------------------------------------------------------------------

it('admits admin and super_admin to the list and the record, and refuses member, coach and guest', function () {
    // There is no CoachApplicationPolicy, and Filament's no-policy fallback
    // is ALLOW (§2.3): without the resource's admin-tier overrides every
    // assertion in the refusal half would be `true`.
    $application = reviewApplication(panelMember());

    expect(CoachApplicationResource::canViewAny())->toBeFalse()
        ->and(CoachApplicationResource::canView($application))->toBeFalse();

    foreach ([panelMember(), panelCoach()] as $refused) {
        $this->actingAs($refused);
        expect(CoachApplicationResource::canViewAny())->toBeFalse()
            ->and(CoachApplicationResource::canView($application))->toBeFalse();
    }

    foreach ([panelAdmin(), panelSuperAdmin()] as $allowed) {
        $this->actingAs($allowed);
        expect(CoachApplicationResource::canViewAny())->toBeTrue()
            ->and(CoachApplicationResource::canView($application))->toBeTrue();
    }
});

it('refuses a member mounting either page with a 403', function () {
    // `RequestBroker` renders an HttpException into a real 403 response
    // rather than rethrowing it, so the status is what is asserted.
    $application = reviewApplication(panelMember());

    Livewire::actingAs(panelMember())->test(ManageCoachApplications::class)->assertForbidden();
    reviewPage(panelMember(), $application)->assertForbidden();
});

// ---------------------------------------------------------------------
// Test 2 — the list
// ---------------------------------------------------------------------

it('lists every non-draft application, with Review as the only record action, linking to the review page', function () {
    $submitted = reviewApplication(panelMember());
    $approved = reviewApplication(panelMember(), 'approved');
    $rejected = reviewApplication(panelMember(), 'rejected');
    $draft = reviewApplication(panelMember(), 'draft');

    $list = Livewire::actingAs(panelAdmin())
        ->test(ManageCoachApplications::class)
        ->loadTable()
        ->assertCanSeeTableRecords([$submitted, $approved, $rejected])
        ->assertCanNotSeeTableRecords([$draft])
        ->assertActionExists(TestAction::make('view')->table($submitted))
        ->assertActionDoesNotExist(TestAction::make('approve')->table($submitted))
        ->assertActionDoesNotExist(TestAction::make('reject')->table($submitted))
        ->assertActionDoesNotExist(TestAction::make('viewDocuments')->table($submitted));

    $viewUrl = CoachApplicationResource::getUrl('view', ['record' => $submitted]);

    expect($list->instance()->getTable()->getRecordUrl($submitted))->toBe($viewUrl);
});

it('narrows by the multi-status filter and sorts undecided applications first', function () {
    $oldRejected = reviewApplication(panelMember(), 'rejected', ['submitted_at' => now()->subDays(10)]);
    $newSubmitted = reviewApplication(panelMember(), 'submitted', ['submitted_at' => now()->subDay()]);
    $oldSubmitted = reviewApplication(panelMember(), 'submitted', ['submitted_at' => now()->subDays(5)]);
    $approved = reviewApplication(panelMember(), 'approved', ['submitted_at' => now()->subDays(20)]);

    Livewire::actingAs(panelAdmin())
        ->test(ManageCoachApplications::class)
        ->loadTable()
        // Undecided first, oldest submission first within each group.
        ->assertCanSeeTableRecords([$oldSubmitted, $newSubmitted, $approved, $oldRejected], inOrder: true)
        ->filterTable('status', ['approved', 'rejected'])
        ->assertCanSeeTableRecords([$approved, $oldRejected])
        ->assertCanNotSeeTableRecords([$oldSubmitted, $newSubmitted]);
});

it('shows two attempts by one applicant as two rows', function () {
    $applicant = panelMember();
    $first = reviewApplication($applicant, 'rejected', ['submitted_at' => now()->subDays(30)]);
    $second = reviewApplication($applicant);

    Livewire::actingAs(panelAdmin())
        ->test(ManageCoachApplications::class)
        ->loadTable()
        ->assertCanSeeTableRecords([$first, $second])
        ->assertCountTableRecords(2);
});

// ---------------------------------------------------------------------
// Test 3 — a draft is not reachable
// ---------------------------------------------------------------------

it('404s a draft on the review route, because {record} resolves through getEloquentQuery()', function () {
    $draft = reviewApplication(panelMember(), 'draft');

    expect(fn () => reviewPage(panelAdmin(), $draft))->toThrow(ModelNotFoundException::class);
});

// ---------------------------------------------------------------------
// Test 4 — rendering
// ---------------------------------------------------------------------

it('renders the statement with its newlines, escaped', function () {
    $application = reviewApplication(panelMember(), 'submitted', ['statement' => "line one\nline two"]);

    reviewPage(panelAdmin(), $application)
        ->assertSuccessful()
        ->assertSchemaComponentStateSet('statement', "line one\nline two")
        ->assertSeeHtml("line one<br>\nline two")
        ->assertSee('Coach application: ');
});

it('escapes applicant markup in the statement rather than rendering it', function () {
    $application = reviewApplication(panelMember(), 'submitted', ['statement' => '<script>alert(1)</script>']);

    reviewPage(panelAdmin(), $application)
        ->assertSeeHtml('&lt;script&gt;alert(1)')
        ->assertDontSeeHtml('<script>alert(1)');
});

it('shows a placeholder for a null statement', function () {
    $application = reviewApplication(panelMember(), 'submitted', ['statement' => null]);

    reviewPage(panelAdmin(), $application)->assertSee('No statement was submitted.');
});

// ---------------------------------------------------------------------
// Test 5 — Download: audit on click, not on render
// ---------------------------------------------------------------------

it('writes no audit row and changes nothing just by opening the page', function () {
    $application = reviewApplication(panelMember());
    reviewDocument($application);

    reviewPage(panelAdmin(), $application)->assertSuccessful();

    expect(AuditLog::query()->where('action', AuditAction::ADMIN_VIEWED_DOCUMENT)->count())->toBe(0)
        ->and($application->fresh()->status)->toBe('submitted');
});

it('audits a Download click once and redirects to a valid signed URL', function () {
    $admin = panelAdmin();
    $application = reviewApplication(panelMember());
    $document = reviewDocument($application);

    $page = reviewPage($admin, $application)
        ->callAction(TestAction::make('download')->schemaComponent('documentsForReview.0'));

    $audit = AuditLog::query()->where('action', AuditAction::ADMIN_VIEWED_DOCUMENT)->sole();
    expect($audit->actor_id)->toBe($admin->id)
        ->and($audit->subject_type)->toBe(ApplicationDocument::class)
        ->and($audit->subject_id)->toBe($document->id)
        ->and($audit->metadata['sha256'])->toBe($document->sha256)
        ->and($audit->metadata['application_id'])->toBe($application->id);

    $redirect = $page->effects['redirect'] ?? null;
    expect($redirect)->toBeString()
        ->and(URL::hasValidSignature(Request::create($redirect)))->toBeTrue()
        ->and($redirect)->toContain('/'.$document->id);
});

it('resolves the Download row by position: position 1 audits position 1', function () {
    $application = reviewApplication(panelMember());
    reviewDocument($application, ['sha256' => str_repeat('a', 64)]);
    $second = reviewDocument($application, ['sha256' => str_repeat('b', 64)]);

    reviewPage(panelAdmin(), $application)
        ->callAction(TestAction::make('download')->schemaComponent('documentsForReview.1'));

    expect(AuditLog::query()->where('action', AuditAction::ADMIN_VIEWED_DOCUMENT)->sole()->subject_id)
        ->toBe($second->id);
});

it('refuses a clean row whose bytes are gone: no audit, no redirect, a danger notification', function () {
    $application = reviewApplication(panelMember());
    reviewDocument($application, withBytes: false);

    reviewPage(panelAdmin(), $application)
        ->callAction(TestAction::make('download')->schemaComponent('documentsForReview.0'))
        ->assertNoRedirect()
        ->assertNotified('This document is no longer available.');

    expect(AuditLog::query()->where('action', AuditAction::ADMIN_VIEWED_DOCUMENT)->count())->toBe(0);
});

it('hides Download on every non-downloadable row, so it cannot be mounted', function (array $attributes) {
    $application = reviewApplication(panelMember());
    reviewDocument($application, $attributes);

    // Stronger than hidden: an `Actions` component whose only action is
    // hidden hides itself, so the action does not resolve at all, and
    // `mountAction` swallows that as a no-op.
    reviewPage(panelAdmin(), $application)
        ->assertActionDoesNotExist(TestAction::make('download')->schemaComponent('documentsForReview.0'))
        ->mountAction(TestAction::make('download')->schemaComponent('documentsForReview.0'))
        ->assertActionNotMounted()
        ->assertNoRedirect();

    expect(AuditLog::query()->where('action', AuditAction::ADMIN_VIEWED_DOCUMENT)->count())->toBe(0);
})->with([
    'pending' => [['status' => 'pending_scan']],
    'infected' => [['status' => 'infected']],
    'purged' => [['path' => '']],
    'erased' => [['path' => '', 'original_filename' => ApplicationDocument::ERASED_FILENAME]],
]);

// ---------------------------------------------------------------------
// Test 6 — Approve / Reject header actions
// ---------------------------------------------------------------------

it('approves: coach role, one decision audit row, a success notification, then both actions hidden', function () {
    $applicant = panelMember();
    $applicant->forceFill(['username' => 'alice'])->save();
    $application = reviewApplication($applicant);
    reviewDocument($application);

    reviewPage(panelAdmin(), $application)
        ->callAction('approve', ['reason' => 'Credentials verified.'])
        ->assertHasNoActionErrors()
        ->assertNotified('Approved: alice is now a coach.')
        ->assertSchemaComponentStateSet('status', 'approved')
        ->assertActionHidden('approve')
        ->assertActionHidden('reject');

    expect($application->fresh()->status)->toBe('approved')
        ->and($applicant->fresh()->hasRole(Role::COACH))->toBeTrue()
        ->and(AuditLog::query()->where('action', AuditAction::COACH_APPLICATION_APPROVED)->count())->toBe(1);
});

it('rejects: status, one decision audit row, a success notification, then both actions hidden', function () {
    $applicant = panelMember();
    $application = reviewApplication($applicant);

    reviewPage(panelAdmin(), $application)
        ->callAction('reject', ['reason' => 'Certificates could not be verified.'])
        ->assertHasNoActionErrors()
        ->assertNotified()
        ->assertActionHidden('approve')
        ->assertActionHidden('reject');

    expect($application->fresh()->status)->toBe('rejected')
        ->and($applicant->fresh()->hasRole(Role::COACH))->toBeFalse()
        ->and(AuditLog::query()->where('action', AuditAction::COACH_APPLICATION_REJECTED)->count())->toBe(1);
});

it('validates the reason: Reject requires one, and both cap it at 1000 characters', function () {
    $application = reviewApplication(panelMember());
    reviewDocument($application);

    reviewPage(panelAdmin(), $application)
        ->callAction('reject', ['reason' => ''])
        ->assertHasActionErrors(['reason' => 'required']);

    reviewPage(panelAdmin(), $application)
        ->callAction('reject', ['reason' => str_repeat('x', 1001)])
        ->assertHasActionErrors(['reason' => 'max']);

    // `decision_reason` is VARCHAR(1000); Postgres would 500 past it, and
    // SQLite would not notice — so the cap has to be the form's.
    reviewPage(panelAdmin(), $application)
        ->callAction('approve', ['reason' => str_repeat('x', 1001)])
        ->assertHasActionErrors(['reason' => 'max']);

    expect($application->fresh()->status)->toBe('submitted');
});

it('hides both actions on a decided application, and mounting Approve is a no-op', function (string $status) {
    $application = reviewApplication(panelMember(), $status);
    reviewDocument($application);

    reviewPage(panelAdmin(), $application)
        ->assertActionHidden('approve')
        ->assertActionHidden('reject')
        ->mountAction('approve')
        ->assertActionNotMounted();

    expect($application->fresh()->status)->toBe($status);
})->with(['approved', 'rejected', 'withdrawn']);

it('hole 3: a member reaching approve is refused inside the closure', function () {
    // Not a reachable production state (the page 403s a member first);
    // it is the only way to show the Gate lives inside the closure. The
    // audit row would be written by the service — which is what made this
    // hole hard to see — so its absence is the assertion.
    //
    // The page itself refuses a member on mount, so the probe is an admin
    // whose `role.assign` is denied by a test Gate::before. The mocked
    // service proves the refusal happens in the CLOSURE: the service
    // re-authorizes internally, so without the mock a missing closure Gate
    // would still be caught one layer down and this test would pass.
    Gate::before(fn ($user, string $ability) => $ability === 'role.assign' ? false : null);
    $this->mock(CoachApplicationDecisionService::class, fn ($mock) => $mock->shouldNotReceive('approve'));

    $applicant = panelMember();
    $application = reviewApplication($applicant);
    reviewDocument($application);

    reviewPage(panelAdmin(), $application)
        ->callAction('approve', ['reason' => 'Sure.'])
        ->assertNotified('This action is unauthorized.');

    expect($applicant->fresh()->hasRole(Role::COACH))->toBeFalse()
        ->and($application->fresh()->status)->toBe('submitted')
        ->and(AuditLog::query()->where('action', AuditAction::COACH_APPLICATION_APPROVED)->count())->toBe(0);
});

it('hole 3: reject is authorized inside the closure too — the Gate is on the capability, not on the outcome', function () {
    // §4's matrix has ONE row for "approve / reject coach application",
    // and both verbs authorize `role.assign` against the APPLICANT.
    Gate::before(fn ($user, string $ability) => $ability === 'role.assign' ? false : null);
    $this->mock(CoachApplicationDecisionService::class, fn ($mock) => $mock->shouldNotReceive('reject'));

    $application = reviewApplication(panelMember());

    reviewPage(panelAdmin(), $application)
        ->callAction('reject', ['reason' => 'No reason at all.'])
        ->assertNotified('This action is unauthorized.');

    expect($application->fresh()->status)->toBe('submitted')
        ->and(AuditLog::query()->where('action', AuditAction::COACH_APPLICATION_REJECTED)->count())->toBe(0);
});

it('stops offering a decision on the next round trip once someone else decided', function () {
    $application = reviewApplication(panelMember());
    reviewDocument($application);

    $page = reviewPage(panelAdmin(), $application)->assertActionVisible('approve');

    // A second admin rejects while this page is open. The record is
    // re-read on every round trip, so `->visible()` hides Approve and the
    // click is refused before the closure runs.
    app(CoachApplicationDecisionService::class)->reject(panelAdmin(), CoachApplication::query()->findOrFail($application->id), 'Too late.');

    $page->callAction('approve', ['reason' => 'Looks good.'])
        ->assertActionHidden('approve')
        ->assertActionHidden('reject');

    expect($application->fresh()->status)->toBe('rejected')
        ->and(AuditLog::query()->where('action', AuditAction::COACH_APPLICATION_APPROVED)->count())->toBe(0);
});

it('refreshes the record when the service refuses mid-request, so a stale page stops offering the decision', function () {
    // The race the round-trip check cannot see: the other decision lands
    // between this request's hydrate and the service's row lock. Simulated
    // with a service that commits a rejection and then 409s, as
    // `decide()` does for a status it no longer accepts.
    $application = reviewApplication(panelMember());
    reviewDocument($application);

    $this->mock(CoachApplicationDecisionService::class, fn ($mock) => $mock->shouldReceive('approve')->once()
        ->andReturnUsing(function () use ($application): void {
            CoachApplication::query()->whereKey($application->id)->update(['status' => 'rejected', 'decided_at' => now()]);

            abort(409, 'Someone else decided first.');
        }));

    reviewPage(panelAdmin(), $application)
        ->callAction('approve', ['reason' => 'Looks good.'])
        ->assertNotified('Someone else decided first.')
        ->assertSchemaComponentStateSet('status', 'rejected')
        ->assertActionHidden('approve')
        ->assertActionHidden('reject');
});

// ---------------------------------------------------------------------
// Test 9 — Approve needs a clean document (Q3, §7)
// ---------------------------------------------------------------------

it('disables Approve without a clean document, and mounting it is a no-op; Reject stays enabled', function (array $documents) {
    $application = reviewApplication(panelMember());

    foreach ($documents as $attributes) {
        reviewDocument($application, $attributes);
    }

    reviewPage(panelAdmin(), $application)
        ->assertActionVisible('approve')
        ->assertActionDisabled('approve')
        ->assertActionEnabled('reject')
        ->mountAction('approve')
        ->assertActionNotMounted();

    expect($application->fresh()->status)->toBe('submitted');
})->with([
    'no document' => [[]],
    'pending only' => [[['status' => 'pending_scan']]],
    'infected only' => [[['status' => 'infected']]],
    'purged only' => [[['path' => '']]],
    'pending, infected and purged' => [[['status' => 'pending_scan'], ['status' => 'infected'], ['path' => '']]],
]);

it('enables Approve and Reject once one document is clean', function () {
    $application = reviewApplication(panelMember());
    reviewDocument($application, ['status' => 'pending_scan']);
    reviewDocument($application);

    reviewPage(panelAdmin(), $application)
        ->assertActionEnabled('approve')
        ->assertActionEnabled('reject');
});

// ---------------------------------------------------------------------
// Test 11 — the review page for an erased / erasing applicant (§9)
// ---------------------------------------------------------------------

it('shows an erased applicant as Erased, with the statement placeholder, erased documents and no decision', function () {
    $applicant = panelMember();
    $applicant->forceFill(['anonymized_at' => now(), 'erasure_started_at' => now()])->save();
    $application = reviewApplication($applicant, 'withdrawn', ['statement' => null]);
    reviewDocument($application, ['path' => '', 'original_filename' => ApplicationDocument::ERASED_FILENAME]);

    $page = reviewPage(panelAdmin(), $application)
        ->assertSuccessful()
        ->assertSchemaComponentStateSet('account', 'Erased')
        ->assertSee('Erased at the applicant’s request.')
        ->assertDontSee('No statement was submitted.')
        ->assertActionHidden('approve')
        ->assertActionHidden('reject')
        ->assertActionDoesNotExist(TestAction::make('download')->schemaComponent('documentsForReview.0'));

    /** @var RepeatableEntry $documents */
    $documents = $page->instance()->getSchema('infolist')->getFlatComponents(withHidden: true)['documentsForReview'];
    $states = array_map(
        fn ($item) => $item->getFlatComponents(withHidden: true)['state']->getState(),
        array_values($documents->getItems()),
    );

    expect($states)->toBe(['Erased']);
});

it('shows Erasing while erasure has started but the account is not yet anonymized', function () {
    $applicant = panelMember();
    $applicant->forceFill(['erasure_started_at' => now()])->save();
    $application = reviewApplication($applicant);

    reviewPage(panelAdmin(), $application)->assertSchemaComponentStateSet('account', 'Erasing');
});

it('disables Approve for an erasing applicant even with a clean document; Reject stays enabled', function () {
    // Mirrors the decision service's §9 409, so the button is never a
    // certain refusal.
    $applicant = panelMember();
    $applicant->forceFill(['erasure_started_at' => now()])->save();
    $application = reviewApplication($applicant);
    reviewDocument($application);

    reviewPage(panelAdmin(), $application)
        ->assertActionVisible('approve')
        ->assertActionDisabled('approve')
        ->assertActionEnabled('reject')
        ->mountAction('approve')
        ->assertActionNotMounted();

    expect($application->fresh()->status)->toBe('submitted');
});

it('reads a withdrawn application as never decided, not as awaiting a decision', function () {
    reviewPage(panelAdmin(), reviewApplication(panelMember(), 'withdrawn'))
        ->assertSee('Withdrawn, never decided')
        ->assertDontSee('Undecided');
});

it('shows a placeholder for an approval decided without a reason', function () {
    reviewPage(panelAdmin(), reviewApplication(panelMember(), 'approved', ['decision_reason' => null]))
        ->assertSee('No reason given.');
});

it('reads the account badge in precedence order: Deleted, Suspended, Active', function () {
    $deleted = panelMember();
    $deleted->forceFill(['deleted_at' => now(), 'suspended_at' => now()])->save();
    $suspended = panelMember();
    $suspended->forceFill(['suspended_at' => now()])->save();

    reviewPage(panelAdmin(), reviewApplication($deleted))->assertSchemaComponentStateSet('account', 'Deleted');
    reviewPage(panelAdmin(), reviewApplication($suspended))->assertSchemaComponentStateSet('account', 'Suspended');
    reviewPage(panelAdmin(), reviewApplication(panelMember()))->assertSchemaComponentStateSet('account', 'Active');
});

// ---------------------------------------------------------------------
// Test 12 — PLAN-COACH-APPLICATION-DECISION-PANEL.md phase 1: the
// "Approve is unavailable" box and the scan-status poll
// ---------------------------------------------------------------------

const POLL_ATTRIBUTE = 'wire:poll.10s="pollScanStatus"';

/** A pending_scan document that is still within its retry budget, so it reads "Scanning". */
function reviewScanningDocument(CoachApplication $application): ApplicationDocument
{
    return reviewDocument($application, ['status' => 'pending_scan']);
}

function reviewErasingApplicant(): User
{
    $applicant = panelMember();
    $applicant->forceFill(['erasure_started_at' => now()])->save();

    return $applicant;
}

/**
 * Each case: the application builder, the box text, and whether the page polls.
 *
 * @return array<string, array{0: Closure(): CoachApplication, 1: string, 2: bool}>
 */
dataset('unavailable approve cases', [
    'erasing, no documents' => [
        fn () => reviewApplication(reviewErasingApplicant()),
        "The applicant is erasing their account, so they can't be approved. You can still reject.",
        false,
    ],
    'erasing with a scanning document' => [
        function () {
            $application = reviewApplication(reviewErasingApplicant());
            reviewScanningDocument($application);

            return $application;
        },
        "The applicant is erasing their account, so they can't be approved. You can still reject.",
        false,
    ],
    'no documents' => [
        fn () => reviewApplication(panelMember()),
        "Approval needs at least one clean document, and the applicant hasn't uploaded any.",
        false,
    ],
    'one scanning document' => [
        function () {
            $application = reviewApplication(panelMember());
            reviewScanningDocument($application);

            return $application;
        },
        'Approval needs at least one clean document. 1 document is still being scanned; this page checks again every 10 seconds.',
        true,
    ],
    'two scanning documents' => [
        function () {
            $application = reviewApplication(panelMember(), 'under_review');
            reviewScanningDocument($application);
            reviewScanningDocument($application);

            return $application;
        },
        'Approval needs at least one clean document. 2 documents are still being scanned; this page checks again every 10 seconds.',
        true,
    ],
    'quarantined only' => [
        function () {
            $application = reviewApplication(panelMember());
            reviewDocument($application, ['status' => 'infected']);

            return $application;
        },
        "Approval needs at least one clean document, and none of the uploaded documents is clean. The Documents tab shows each one's status.",
        false,
    ],
    'purged only' => [
        function () {
            $application = reviewApplication(panelMember());
            reviewDocument($application, ['path' => ''], withBytes: false);

            return $application;
        },
        "Approval needs at least one clean document, and none of the uploaded documents is clean. The Documents tab shows each one's status.",
        false,
    ],
    'scan failed only' => [
        function () {
            $application = reviewApplication(panelMember());
            reviewDocument($application, ['status' => 'pending_scan', 'work_attempts' => 99]);

            return $application;
        },
        "Approval needs at least one clean document, and none of the uploaded documents is clean. The Documents tab shows each one's status.",
        false,
    ],
    // `displayState()`'s one tricky branch: retries are used up, but a live
    // lease means a worker still holds the row and may yet finish it.
    'retries used up but a worker holds the lease' => [
        function () {
            $application = reviewApplication(panelMember());
            reviewDocument($application, ['status' => 'pending_scan', 'work_attempts' => 99, 'work_lease_until' => now()->addMinute()]);

            return $application;
        },
        'Approval needs at least one clean document. 1 document is still being scanned; this page checks again every 10 seconds.',
        true,
    ],
    'erased document only' => [
        function () {
            $application = reviewApplication(panelMember());
            reviewDocument($application, ['path' => '', 'original_filename' => ApplicationDocument::ERASED_FILENAME], withBytes: false);

            return $application;
        },
        "Approval needs at least one clean document, and none of the uploaded documents is clean. The Documents tab shows each one's status.",
        false,
    ],
    'quarantined plus scanning' => [
        function () {
            $application = reviewApplication(panelMember());
            reviewDocument($application, ['status' => 'infected']);
            reviewScanningDocument($application);

            return $application;
        },
        'Approval needs at least one clean document. 1 document is still being scanned; this page checks again every 10 seconds.',
        true,
    ],
]);

it('explains why Approve is unavailable, polls only while a scan is pending, and announces as a status', function (Closure $build, string $text, bool $polls) {
    $page = reviewPage(panelAdmin(), $build())
        ->assertSee('Approve is unavailable')
        ->assertSeeText($text)
        ->assertSeeHtml('role="status"');

    $polls ? $page->assertSeeHtml(POLL_ATTRIBUTE) : $page->assertDontSeeHtml(POLL_ATTRIBUTE);
})->with('unavailable approve cases');

it('shows no box and no poll when Approve is allowed, even with another document still scanning', function () {
    $application = reviewApplication(panelMember());
    reviewDocument($application);
    reviewScanningDocument($application);

    reviewPage(panelAdmin(), $application)
        ->assertActionEnabled('approve')
        ->assertDontSee('Approve is unavailable')
        ->assertDontSeeHtml(POLL_ATTRIBUTE);
});

it('shows no box and no poll on a decided application without a clean document', function (string $status) {
    $application = reviewApplication(panelMember(), $status);
    reviewScanningDocument($application);

    reviewPage(panelAdmin(), $application)
        ->assertDontSee('Approve is unavailable')
        ->assertDontSeeHtml(POLL_ATTRIBUTE);
})->with(['approved', 'rejected', 'withdrawn']);

it('unlocks Approve on the next poll once the scan finishes: box and poll attribute go away', function () {
    $application = reviewApplication(panelMember());
    $document = reviewScanningDocument($application);

    $page = reviewPage(panelAdmin(), $application)
        ->assertActionDisabled('approve')
        ->assertSee('Approve is unavailable')
        ->assertSeeHtml(POLL_ATTRIBUTE);

    $document->forceFill(['status' => 'clean'])->save();
    Storage::disk('application_documents')->put($document->path, '%PDF-1.4 fake');

    $page->call('pollScanStatus')
        ->assertActionEnabled('approve')
        ->assertDontSee('Approve is unavailable')
        ->assertDontSeeHtml(POLL_ATTRIBUTE);
});

it('stops polling when a scan ends without a clean result, and switches to the none-is-clean text', function (array $ending) {
    $application = reviewApplication(panelMember());
    $document = reviewScanningDocument($application);

    $page = reviewPage(panelAdmin(), $application)->assertSeeHtml(POLL_ATTRIBUTE);

    $document->forceFill($ending)->save();

    $page->call('pollScanStatus')
        ->assertDontSeeHtml(POLL_ATTRIBUTE)
        ->assertSeeText("Approval needs at least one clean document, and none of the uploaded documents is clean. The Documents tab shows each one's status.")
        ->assertActionDisabled('approve');
})->with([
    'quarantined' => [['status' => 'infected']],
    'retries used up, lease expired' => [['work_attempts' => 99, 'work_lease_until' => now()->subMinute()]],
]);

it('counts every answered poll, and stops promising checks after the 30th', function () {
    $application = reviewApplication(panelMember());
    reviewScanningDocument($application);

    $page = reviewPage(panelAdmin(), $application)
        ->call('pollScanStatus')
        ->call('pollScanStatus')
        ->assertSet('scanPolls', 2);

    // The 29th poll still leaves the attribute; the 30th removes it.
    $page->set('scanPolls', 28)
        ->call('pollScanStatus')
        ->assertSeeHtml(POLL_ATTRIBUTE)
        ->assertSeeText('this page checks again every 10 seconds')
        ->call('pollScanStatus')
        ->assertDontSeeHtml(POLL_ATTRIBUTE)
        ->assertSeeText('1 document is still being scanned. Automatic checking has stopped; reload the page to check again.')
        ->assertSee('Approve is unavailable');
});

it('re-renders on a poll when no pop-up is open', function () {
    $application = reviewApplication(panelMember());
    reviewScanningDocument($application);

    $page = reviewPage(panelAdmin(), $application)->call('pollScanStatus');

    expect($page->effects)->toHaveKey('html');
});

it('skips the render while a pop-up is open, so a half-typed reason survives the poll', function () {
    $application = reviewApplication(panelMember());
    $document = reviewScanningDocument($application);

    $page = reviewPage(panelAdmin(), $application)
        ->mountAction('reject')
        ->fillForm(['reason' => 'Half-typed reason']);

    // Filament renders only the open pop-up while one is mounted, and never
    // the full page. The page is changed first so that a full render would
    // show: it would drop the box and the poll attribute.
    $document->forceFill(['status' => 'clean'])->save();
    Storage::disk('application_documents')->put($document->path, '%PDF-1.4 fake');

    $page->call('pollScanStatus');

    expect($page->effects)->not->toHaveKey('html');

    $page->assertActionMounted('reject')->callMountedAction();

    $fresh = $application->fresh();
    expect($fresh->status)->toBe('rejected')
        ->and($fresh->decision_reason)->toBe('Half-typed reason');
});

it('re-authorizes every poll: a demoted admin gets a 403', function () {
    $application = reviewApplication(panelMember());
    $admin = panelAdmin();

    $page = reviewPage($admin, $application);
    $admin->syncRoles([Role::MEMBER]);

    $page->call('pollScanStatus')->assertForbidden();
});

it('puts the erasing reason ahead of the missing-document reason on the Approve tooltip', function () {
    $erasing = reviewApplication(reviewErasingApplicant());
    $empty = reviewApplication(panelMember());

    $tooltip = fn (CoachApplication $application): ?string => reviewPage(panelAdmin(), $application)
        ->instance()->getAction('approve')->getTooltip();

    expect($tooltip($erasing))->toBe('The applicant is erasing their account.')
        ->and($tooltip($empty))->toBe('Approval needs at least one clean document.');
});

// ---------------------------------------------------------------------
// Test 13 — phase 2: queue navigation and the Documents column
// ---------------------------------------------------------------------

/** An application submitted `$daysAgo` days before a fixed moment. */
function queueApplication(string $status = 'submitted', int $daysAgo = 0, array $attributes = []): CoachApplication
{
    return reviewApplication(panelMember(), $status, array_merge([
        'submitted_at' => now()->startOfDay()->subDays($daysAgo),
    ], $attributes));
}

/** @return list<int> */
function queueWalk(CoachApplication $start, string $direction, int $steps): array
{
    $visited = [];
    $current = $start;

    for ($i = 0; $i < $steps; $i++) {
        $current = $current->{$direction}();
        $visited[] = $current?->id;
    }

    return $visited;
}

/** Statements that touch the given table, recorded while `$work` runs. */
function statementsTouching(string $needle, Closure $work): array
{
    DB::flushQueryLog();
    DB::enableQueryLog();
    $work();
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    return array_values(array_filter(
        array_column($log, 'query'),
        fn (string $sql): bool => str_contains($sql, $needle),
    ));
}

it('walks next and previous in submitted order, wrapping at both ends and never returning a decided row', function () {
    $a = queueApplication('submitted', 5);
    $b = queueApplication('under_review', 3);
    $c = queueApplication('submitted', 1);
    $decided = queueApplication('approved', 4);

    expect($b->nextUndecided()->id)->toBe($c->id)
        ->and($b->previousUndecided()->id)->toBe($a->id)
        ->and($c->nextUndecided()->id)->toBe($a->id)
        ->and($c->previousUndecided()->id)->toBe($b->id)
        ->and($a->nextUndecided()->id)->toBe($b->id)
        ->and($a->previousUndecided()->id)->toBe($c->id);

    foreach ([$a, $b, $c, $decided] as $from) {
        expect($from->nextUndecided()?->id)->not->toBe($decided->id)
            ->and($from->previousUndecided()?->id)->not->toBe($decided->id);
    }
});

it('breaks equal submitted_at ties by id, without looping or skipping', function () {
    $moment = now()->startOfDay()->subDays(2);
    $a = queueApplication('submitted', 0, ['submitted_at' => $moment]);
    $b = queueApplication('submitted', 0, ['submitted_at' => $moment]);
    $c = queueApplication('submitted', 1);
    expect($a->id)->toBeLessThan($b->id);

    expect($a->nextUndecided()->id)->toBe($b->id)
        ->and($b->previousUndecided()->id)->toBe($a->id);

    // Queue order is c, a, b. Two laps of next visit each row twice, in order.
    expect(queueWalk($c, 'nextUndecided', 6))->toBe([$a->id, $b->id, $c->id, $a->id, $b->id, $c->id])
        ->and(queueWalk($c, 'previousUndecided', 3))->toBe([$b->id, $a->id, $c->id]);
});

it('skips decided, rejected, withdrawn and draft rows even when they fall between undecided ones', function () {
    $oldest = queueApplication('submitted', 10);
    queueApplication('approved', 9);
    queueApplication('rejected', 8);
    queueApplication('withdrawn', 7);
    queueApplication('draft', 6, ['submitted_at' => now()->startOfDay()->subDays(6)]);
    $underReview = queueApplication('under_review', 5);
    queueApplication('rejected', 4);
    $newest = queueApplication('submitted', 3);

    expect($oldest->nextUndecided()->id)->toBe($underReview->id)
        ->and($underReview->nextUndecided()->id)->toBe($newest->id)
        ->and($newest->previousUndecided()->id)->toBe($underReview->id)
        ->and($underReview->previousUndecided()->id)->toBe($oldest->id);
});

it('has no neighbour when it is the only undecided application, or the only row', function () {
    $only = queueApplication('submitted', 1);
    expect($only->nextUndecided())->toBeNull()
        ->and($only->previousUndecided())->toBeNull();

    $decided = queueApplication('approved', 2);
    expect($only->nextUndecided())->toBeNull()
        ->and($only->previousUndecided())->toBeNull()
        ->and($decided->nextUndecided()->id)->toBe($only->id)
        ->and($decided->previousUndecided()->id)->toBe($only->id);
});

it('handles a null submitted_at (withdrawn from a draft): oldest next, newest previous, and the page renders', function () {
    $oldest = queueApplication('submitted', 8);
    queueApplication('under_review', 4);
    $newest = queueApplication('submitted', 1);
    $withdrawn = reviewApplication(panelMember(), 'withdrawn', ['submitted_at' => null]);

    expect($withdrawn->nextUndecided()->id)->toBe($oldest->id)
        ->and($withdrawn->previousUndecided()->id)->toBe($newest->id);

    reviewPage(panelAdmin(), $withdrawn)
        ->assertSuccessful()
        ->assertActionVisible('nextUndecided')
        ->assertActionVisible('previousUndecided');
});

it('shows Previous and Next undecided links to the right neighbours', function () {
    $a = queueApplication('submitted', 5);
    $b = queueApplication('submitted', 3);
    $c = queueApplication('submitted', 1);

    $url = fn (CoachApplication $record): string => CoachApplicationResource::getUrl('view', ['record' => $record->id]);

    reviewPage(panelAdmin(), $b)
        ->assertActionVisible('previousUndecided')
        ->assertActionVisible('nextUndecided')
        ->assertActionHasLabel('previousUndecided', 'Previous undecided')
        ->assertActionHasLabel('nextUndecided', 'Next undecided')
        ->assertActionHasUrl('previousUndecided', $url($a))
        ->assertActionHasUrl('nextUndecided', $url($c));

    // Wrapping: the newest links forward to the oldest.
    reviewPage(panelAdmin(), $c)->assertActionHasUrl('nextUndecided', $url($a));
});

it('hides both links when no other undecided application exists, but keeps them on a decided application', function () {
    $only = queueApplication('submitted', 2);
    $decided = queueApplication('approved', 3);

    reviewPage(panelAdmin(), $only)
        ->assertActionHidden('previousUndecided')
        ->assertActionHidden('nextUndecided');

    reviewPage(panelAdmin(), $decided)
        ->assertActionVisible('previousUndecided')
        ->assertActionVisible('nextUndecided')
        ->assertActionHasUrl('nextUndecided', CoachApplicationResource::getUrl('view', ['record' => $only->id]));

    $only->forceFill(['status' => 'rejected', 'decided_at' => now()])->save();

    reviewPage(panelAdmin(), $decided)
        ->assertActionHidden('previousUndecided')
        ->assertActionHidden('nextUndecided');
});

it('orders the header actions previous, next, approve, reject', function () {
    $current = queueApplication('submitted', 2);
    queueApplication('submitted', 1);

    $names = array_map(
        fn ($action) => $action->getName(),
        reviewPage(panelAdmin(), $current)->instance()->getCachedHeaderActions(),
    );

    expect(array_values(array_intersect($names, ['previousUndecided', 'nextUndecided', 'approve', 'reject'])))
        ->toBe(['previousUndecided', 'nextUndecided', 'approve', 'reject']);
});

it('looks up each neighbour at most once per direction while the page renders', function () {
    // The middle of the queue, so both the after and the before query find a
    // row and the wrap query never runs: exactly two lookups when memoized.
    $current = queueApplication('submitted', 2);
    queueApplication('submitted', 3);
    queueApplication('submitted', 1);

    $queries = statementsTouching('"coach_applications"', function () use ($current) {
        reviewPage(panelAdmin(), $current)->assertSuccessful();
    });

    // Neighbour lookups are the only statements that compare submitted_at.
    $neighbourQueries = array_filter($queries, fn (string $sql): bool => str_contains($sql, '"submitted_at" >')
        || str_contains($sql, '"submitted_at" <')
        || str_contains($sql, '"submitted_at" = ?'));

    expect(count($neighbourQueries))->toBe(2);
});

it('formats the Documents column as None, "total · clean clean", and does not count a purged row as clean', function () {
    $none = queueApplication('submitted', 4);

    $pending = queueApplication('submitted', 3);
    reviewDocument($pending, ['status' => 'pending_scan']);

    $mixed = queueApplication('submitted', 2);
    reviewDocument($mixed);
    reviewDocument($mixed, ['status' => 'infected']);

    $purged = queueApplication('submitted', 1);
    reviewDocument($purged, ['status' => 'clean', 'path' => ''], withBytes: false);

    Livewire::actingAs(panelAdmin())
        ->test(ManageCoachApplications::class)
        ->loadTable()
        ->assertTableColumnFormattedStateSet('documents_count', 'None', $none)
        ->assertTableColumnFormattedStateSet('documents_count', "1 \u{00B7} 0 clean", $pending)
        ->assertTableColumnFormattedStateSet('documents_count', "2 \u{00B7} 1 clean", $mixed)
        ->assertTableColumnFormattedStateSet('documents_count', "1 \u{00B7} 0 clean", $purged);
});

it('runs the same number of application_documents statements for 1 and for 3 listed applications', function () {
    $render = fn () => statementsTouching('application_documents', function () {
        Livewire::actingAs(panelAdmin())->test(ManageCoachApplications::class)->loadTable();
    });

    $first = queueApplication('submitted', 1);
    reviewDocument($first);
    reviewDocument($first, ['status' => 'pending_scan']);
    $withOne = count($render());

    foreach ([2, 3] as $daysAgo) {
        $extra = queueApplication('submitted', $daysAgo);
        reviewDocument($extra);
        reviewDocument($extra, ['status' => 'infected']);
    }
    $withThree = count($render());

    expect($withOne)->toBeGreaterThan(0)
        ->and($withThree)->toBe($withOne);
});

it('lists undecided applications with equal submitted_at by id ascending', function () {
    $moment = now()->startOfDay()->subDay();
    $first = queueApplication('submitted', 0, ['submitted_at' => $moment]);
    $second = queueApplication('under_review', 0, ['submitted_at' => $moment]);
    $third = queueApplication('submitted', 0, ['submitted_at' => $moment]);

    Livewire::actingAs(panelAdmin())
        ->test(ManageCoachApplications::class)
        ->loadTable()
        ->assertCanSeeTableRecords([$first, $second, $third], inOrder: true);
});

it('orders the list by id after submitted_at in SQL, so equal timestamps cannot reorder on Postgres', function () {
    // SQLite returns ties in row order whatever the SQL says, so the data
    // tests above cannot see a missing tiebreak. The SQL can.
    $statements = statementsTouching('"coach_applications"', fn () => Livewire::actingAs(panelAdmin())
        ->test(ManageCoachApplications::class)
        ->loadTable());

    $select = collect($statements)->first(fn (string $sql): bool => str_contains($sql, 'order by'));

    expect($select)->toContain('"submitted_at" asc, "id" asc');
});

it('does not blow up when a hidden Next or Previous link is mounted anyway', function () {
    // A hand-crafted Livewire call can mount an action whatever its
    // visibility; with no neighbour the URL closure must not throw.
    $only = queueApplication('submitted', 1);

    reviewPage(panelAdmin(), $only)
        ->assertActionHidden('nextUndecided')
        ->mountAction('nextUndecided')
        ->assertSuccessful()
        ->mountAction('previousUndecided')
        ->assertSuccessful();
});
