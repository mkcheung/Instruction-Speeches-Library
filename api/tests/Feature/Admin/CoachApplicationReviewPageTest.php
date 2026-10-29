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
