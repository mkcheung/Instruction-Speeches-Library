<?php

use App\Filament\Resources\CoachApplicationResource\Pages\ManageCoachApplications;
use App\Filament\Resources\ReportResource\Pages\ManageReports;
use App\Filament\Resources\SpeechResource\Pages\ManageSpeeches;
use App\Filament\Resources\UserResource\Pages\ManageUsers;
use App\Jobs\PurgeSpeechMedia;
use App\Models\Annotation;
use App\Models\ApplicationDocument;
use App\Models\AuditLog;
use App\Models\CoachApplication;
use App\Models\Report;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Notifications\AccountSuspended;
use App\Notifications\SpeechTakenDown;
use App\Services\RoleAssignmentService;
use App\Support\AuditAction;
use App\Support\Role;
use Database\Seeders\RoleSeeder;
use Filament\Actions\Testing\TestAction;
use Filament\Facades\Filament;
use Filament\Tables\Table;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Notification;
use Livewire\Livewire;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * PLAN-ADMIN-DASHBOARD.md §5.4/§5.5/§5.7 — the panel-side half of Phase
 * 1's tests. §9 records that "the panel has never been exercised by a
 * browser in CI, and no test asserts `/control-panel` status codes"
 * (`STEP-12-RETROSPECTIVE.md:36` admits it), which is exactly how eight
 * authorization holes survived a step that was reviewed twice: nothing
 * ever called these closures.
 *
 * These are Livewire tests, not HTTP tests, and that distinction is the
 * point. `EnsureUserIsAdmin` guards the ROUTE; every hole below was
 * inside an action closure BEHIND that guard. Driving the component
 * directly is the only way to assert the thing the plan actually cares
 * about — that each closure authorizes for itself rather than inheriting
 * a middleware's word for it. §9 confirms this works today without new
 * dependencies (`livewire/livewire 3.8.6` is installed transitively;
 * `pestphp/pest-plugin-livewire` would only add the `livewire()` sugar).
 *
 * `Filament::setCurrentPanel('admin')` is required because no panel
 * middleware runs in a Livewire test — the panel is normally bound by
 * `/control-panel`'s own middleware stack, which these tests deliberately
 * skip.
 *
 * ⚠️ A non-admin actor is used as the denial probe throughout. That is
 * not a reachable production state (the route 403s first) and it is not
 * pretending to be: it is the only way to prove a Gate call exists INSIDE
 * the closure, which is precisely the property that was missing. Mirrors
 * `AdminAbilityDenialTest`'s stated approach — "direct Gate assertions,
 * not just an absent button".
 *
 * Hole 5 (`RoleAssignmentService`) is covered here rather than in
 * `RoleAssignmentServiceTest.php` on purpose: that file predates this plan
 * and pins the last-admin roster contract, while every assertion below is
 * about one of §5.4's eight holes. Keeping the plan's coverage in one file
 * is what makes "all eight are closed" checkable in one place.
 */
beforeEach(function () {
    $this->seed(RoleSeeder::class);
    Filament::setCurrentPanel('admin');
    renderPanelTablesWithoutIntl();
});

/**
 * ⚠️ ENVIRONMENT, not a test convenience. `filament/support` declares
 * `ext-intl: *` in its own `require` (composer.lock), and this dev host has
 * no `intl` — `composer install` here must have run with
 * `--ignore-platform-req=ext-intl`, the same flag the Dockerfile passes at
 * lines 39/307. The production image installs it for real
 * (`docker-php-ext-install ... intl ...`, Dockerfile:115), so the gap is
 * local-only, but it makes EVERY Filament table render throw
 * `RuntimeException: The "intl" PHP extension is required to use the
 * [format] method` out of `Illuminate\Support\Number::format()`. All twelve
 * tests in the first draft of this file errored on exactly that and none
 * had ever been run — which is how §5.4's eight holes nearly shipped
 * "tested" a second time.
 *
 * Two independent render paths reach `Number::format()`, so two levers:
 *
 *  - `paginated(false)` — `filament/support`'s `components/pagination/
 *    index.blade.php:51-53` formats first/last/total. Guarded by
 *    `@if ($hasPagination)` (`tables/.../index.blade.php:2555`), so turning
 *    pagination off removes the component entirely. Pagination is noise in
 *    a test with three rows.
 *  - `deferLoading()`, and ONLY for `ManageUsers` —
 *    `tables/.../index.blade.php:813` formats `$allSelectableRecordsCount`
 *    inside the select-all indicator, which renders when
 *    `$isSelectionEnabled && ($maxSelectableRecords !== 1) && $isLoaded`
 *    (:772). `UserResource` is the one table in this panel with a
 *    `BulkAction`, so it is the only one where `$isSelectionEnabled` is
 *    true. `deferLoading` leaves `$isLoaded` false — nothing calls
 *    `loadTable` in a Livewire test — which skips that branch.
 *
 * It must be `deferLoading()` on `ManageUsers` ALONE. Deferring every table
 * also skips the mounted action's modal body, and holes 6/7 are asserted by
 * reading that body: under a blanket `deferLoading()` the annotations modal
 * renders as nothing, `assertSee('PUBLISHED-TEXT')` fails, and the audit
 * row it is paired with still appears — a test that looks half-right for
 * entirely the wrong reason. `getLivewire()` is readable here because
 * `Table::make()` sets it in the constructor, before `configure()` runs
 * (`Table.php:70-77`).
 *
 * Registered per test rather than once per process:
 * `Configurable::configureUsing()` delegates to
 * `ComponentManager::resolve()`, which is container-scoped and so is thrown
 * away with the application between tests.
 */
function renderPanelTablesWithoutIntl(): void
{
    Table::configureUsing(function (Table $table): void {
        $table->paginated(false);

        if ($table->getLivewire() instanceof ManageUsers) {
            $table->deferLoading();
        }
    });
}

function panelAdmin(): User
{
    $admin = User::factory()->create();
    $admin->assignRole(Role::ADMIN);

    return $admin;
}

function panelSuperAdmin(): User
{
    $superAdmin = User::factory()->create();
    $superAdmin->assignRole(Role::SUPER_ADMIN);

    return $superAdmin;
}

function panelMember(): User
{
    $member = User::factory()->create();
    $member->assignRole(Role::MEMBER);

    return $member;
}

function panelCoach(): User
{
    $coach = User::factory()->create();
    $coach->assignRole(Role::COACH);

    return $coach;
}

/**
 * No `CoachApplicationFactory` exists in this codebase — the only other
 * test that needs an application drives `POST /api/coach-applications` for
 * one (`CoachApplicationHttpTest`). Built directly here instead: these
 * tests are about the Filament actions' Gates, so routing through the
 * submission endpoint would add a second subject under test.
 */
function panelSubmittedApplication(User $applicant): CoachApplication
{
    $application = CoachApplication::query()->create([
        'user_id' => $applicant->id,
        'status' => 'submitted',
        'statement' => 'Fifteen years of competitive speaking.',
    ]);

    $application->forceFill(['submitted_at' => now()])->save();

    return $application;
}

function panelCleanDocument(CoachApplication $application, string $filename, string $hashChar): ApplicationDocument
{
    return ApplicationDocument::query()->create([
        'application_id' => $application->id,
        'disk' => 'application_documents',
        'path' => 'documents/'.$filename,
        'original_filename' => $filename,
        'byte_size' => 2048,
        'sha256' => str_repeat($hashChar, 64),
        'status' => 'clean',
    ]);
}

/**
 * `RoleAssignmentService` guards with `abort_if(...)`, so a denial arrives
 * as Symfony's `HttpException` and the STATUS is the assertion worth
 * making: §5.4's two guards deliberately answer with different codes (403
 * for the super-admin-only tier check, 422 for the self-check, matching
 * `UserDeletionService::suspend()`'s own self-check), and a test that
 * asserted only "it threw" would still pass if the two were collapsed.
 */
function captureHttpStatus(Closure $callback): ?int
{
    try {
        $callback();
    } catch (HttpException $e) {
        return $e->getStatusCode();
    }

    return null;
}

// ---------------------------------------------------------------------
// §5.4 hole 1 — UserResource::toggleSuspend, the unsuspend branch
// ---------------------------------------------------------------------

it('hole 1: the unsuspend branch is gated — an admin cannot unsuspend themselves through the panel', function () {
    // `Gate::authorize('user.suspend', ...)` used to sit in the `else`
    // only, so this exact call reached `unsuspend()` with no policy
    // consulted at all. `UserPolicy::canModerate()` excludes self, so a
    // self-unsuspend is the cleanest probe of the branch: a second active
    // admin exists, which means the last-admin clause passes and ONLY the
    // self-exclusion can be what denies this.
    $other = panelAdmin();
    $admin = panelAdmin();
    $admin->forceFill(['suspended_at' => now()])->save();

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('toggleSuspend')->table($admin), ['reason' => 'Changed my mind.']);

    expect($admin->fresh()->suspended_at)->not->toBeNull()
        ->and($other->fresh()->suspended_at)->toBeNull()
        ->and(AuditLog::query()->where('action', AuditAction::USER_UNSUSPENDED)->count())->toBe(0);
});

it('hole 1: a non-admin reaching the unsuspend branch is refused by the closure, not by the route', function () {
    // The complement of the self-probe above. That one proves the Gate
    // runs at all on this branch; this one proves the Gate is what
    // decides, against a target the policy has no self-exclusion argument
    // about.
    $target = panelMember();
    $target->forceFill(['suspended_at' => now()])->save();

    Livewire::actingAs(panelMember())
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('toggleSuspend')->table($target), ['reason' => 'Letting my friend back in.']);

    expect($target->fresh()->suspended_at)->not->toBeNull()
        ->and(AuditLog::query()->where('action', AuditAction::USER_UNSUSPENDED)->count())->toBe(0);
});

it('hole 1: a legitimate unsuspend still works, and audits the reason (§5.5)', function () {
    $admin = panelAdmin();
    $target = panelMember();
    $target->forceFill(['suspended_at' => now()])->save();

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('toggleSuspend')->table($target), ['reason' => 'Appeal upheld.']);

    expect($target->fresh()->suspended_at)->toBeNull();

    $audit = AuditLog::query()->where('action', AuditAction::USER_UNSUSPENDED)->sole();
    expect($audit->metadata['reason'])->toBe('Appeal upheld.')
        ->and($audit->actor_id)->toBe($admin->id)
        ->and($audit->subject_id)->toBe($target->id);
});

// ---------------------------------------------------------------------
// §5.5 — mandatory moderation reason + notice to the affected user
// ---------------------------------------------------------------------

it('§5.5: suspend requires a reason, records it in the audit row, and notifies the suspended user', function () {
    Notification::fake();
    $admin = panelAdmin();
    $target = panelMember();

    // Empty reason: the action must not run at all.
    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('toggleSuspend')->table($target), ['reason' => ''])
        ->assertHasActionErrors(['reason' => 'required']);

    expect($target->fresh()->suspended_at)->toBeNull();

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('toggleSuspend')->table($target), ['reason' => 'Harassment in connection requests.']);

    expect($target->fresh()->suspended_at)->not->toBeNull();

    $audit = AuditLog::query()->where('action', AuditAction::USER_SUSPENDED)->sole();
    expect($audit->metadata['reason'])->toBe('Harassment in connection requests.');

    Notification::assertSentTo($target, AccountSuspended::class);
});

it('§5.5/§5.7: the bulk suspend path also requires a reason, audits every target, and notifies each one', function () {
    Notification::fake();
    $admin = panelAdmin();
    $first = panelMember();
    $second = panelMember();

    // This action wrote NO audit row at all before §5.7 — a 25-user
    // suspension was invisible in `audit_log` while a single one was not.
    //
    // ⚠️ `selectTableRecords()` is load-bearing. It sets the component's
    // `selectedTableRecords` property, which is where a `BulkAction` reads
    // its `$records` from. Passing the keys as `callAction`'s third
    // argument instead sends them as action ARGUMENTS, which the closure
    // never reads: the action then runs against an EMPTY selection, writes
    // nothing, and every assertion below passes vacuously.
    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->selectTableRecords([$first, $second])
        ->callAction(TestAction::make('suspendSelected')->table()->bulk(), ['reason' => ''])
        ->assertHasActionErrors(['reason' => 'required']);

    expect($first->fresh()->suspended_at)->toBeNull();

    Livewire::actingAs($admin)
        ->test(ManageUsers::class)
        ->selectTableRecords([$first, $second])
        ->callAction(TestAction::make('suspendSelected')->table()->bulk(), ['reason' => 'Coordinated spam.']);

    expect($first->fresh()->suspended_at)->not->toBeNull()
        ->and($second->fresh()->suspended_at)->not->toBeNull()
        ->and(AuditLog::query()->where('action', AuditAction::USER_SUSPENDED)->count())->toBe(2);

    $audit = AuditLog::query()->where('action', AuditAction::USER_SUSPENDED)->first();
    expect($audit->metadata['reason'])->toBe('Coordinated spam.')
        ->and($audit->metadata['bulk'])->toBeTrue();

    Notification::assertSentTo($first, AccountSuspended::class);
    Notification::assertSentTo($second, AccountSuspended::class);
});

// ---------------------------------------------------------------------
// §5.4 hole 2 + §5.5 + §5.6 + §6.3 — SpeechResource takedown / restore
// ---------------------------------------------------------------------

it('hole 2: takedown is authorized inside the closure, not just by EnsureUserIsAdmin', function () {
    $member = panelMember();
    $speech = Speech::factory()->for(panelMember())->create();

    // Before the fix this closure had no `Gate::authorize` anywhere, so
    // reaching it at all was sufficient to destroy content. The speech
    // must survive.
    Livewire::actingAs($member)
        ->test(ManageSpeeches::class)
        ->callAction(TestAction::make('takedown')->table($speech), ['reason' => 'Because I can.']);

    expect($speech->fresh()->trashed())->toBeFalse()
        ->and(AuditLog::query()->where('action', AuditAction::SPEECH_TAKEN_DOWN)->count())->toBe(0);
});

it('hole 2 + §5.5 + §5.6: an admin takedown requires a reason, audits it, notifies the speaker and enqueues the byte purge', function () {
    Notification::fake();
    Bus::fake();
    $admin = panelAdmin();
    $speaker = panelMember();
    $speech = Speech::factory()->for($speaker)->create();

    Livewire::actingAs($admin)
        ->test(ManageSpeeches::class)
        ->callAction(TestAction::make('takedown')->table($speech), ['reason' => ''])
        ->assertHasActionErrors(['reason' => 'required']);

    expect($speech->fresh()->trashed())->toBeFalse();

    Livewire::actingAs($admin)
        ->test(ManageSpeeches::class)
        ->callAction(TestAction::make('takedown')->table($speech), ['reason' => 'Copyrighted backing track.']);

    expect($speech->fresh()->trashed())->toBeTrue();

    $audit = AuditLog::query()->where('action', AuditAction::SPEECH_TAKEN_DOWN)->sole();
    // Was `metadata: []`. §5.5: without the reason the trail records that
    // a speech was removed and nothing about why.
    expect($audit->metadata['reason'])->toBe('Copyrighted backing track.');

    Notification::assertSentTo($speaker, SpeechTakenDown::class);

    // §5.6. Dispatched EAGERLY, deliberately: `PurgeSpeechMedia` enforces
    // the 30-day quarantine internally and refuses an in-window speech, so
    // the dispatch is a safe no-op today and the call site does not have to
    // know the window. Asserted at the Bus rather than by running the job
    // — the refusal itself belongs to that job's own test.
    Bus::assertDispatched(PurgeSpeechMedia::class);
});

it('§6.3: restore un-takes-down a speech and audits it, and is denied to a non-admin', function () {
    $speech = Speech::factory()->for(panelMember())->create();
    $speech->delete();

    Livewire::actingAs(panelMember())
        ->test(ManageSpeeches::class)
        ->callAction(TestAction::make('restore')->table($speech));

    expect($speech->fresh()->trashed())->toBeTrue();

    Livewire::actingAs(panelAdmin())
        ->test(ManageSpeeches::class)
        ->callAction(TestAction::make('restore')->table($speech));

    expect($speech->fresh()->trashed())->toBeFalse()
        ->and(AuditLog::query()->where('action', AuditAction::SPEECH_RESTORED)->count())->toBe(1);
});

// ---------------------------------------------------------------------
// §5.4 holes 6 + 7 — the annotations modal
// ---------------------------------------------------------------------

it('holes 6 + 7: opening the annotations modal audits the read and hides a draft from an admin who owns the speech', function () {
    // The owner exclusion is the whole point: `AnnotationPolicy::
    // readAnnotations` and `Annotation::scopeVisibleTo` both carry
    // `speech_owner_id !== $user->id` precisely so an admin who is also the
    // SPEAKER cannot read their own coach's unpublished drafts. The old raw
    // `Annotation::query()->where('review_id', ...)` had neither, and handed
    // over draft text verbatim.
    $adminSpeaker = panelAdmin();
    $coach = panelCoach();

    $speech = Speech::factory()->for($adminSpeaker)->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $coach->id,
        'speech_owner_id' => $adminSpeaker->id,
    ]);

    Annotation::factory()->for($review)->create(['body' => 'DRAFT-ONLY-TEXT', 'published_at' => null]);
    Annotation::factory()->for($review)->create(['body' => 'PUBLISHED-TEXT', 'published_at' => now()]);

    // `loadTable()` is required before any table action can be mounted:
    // Filament v4 renders the table shell with `wire:init="loadTable"`
    // (tables/resources/views/index.blade.php:208-210) and fills it on a
    // follow-up Livewire round trip. Without this the snapshot is still
    // the empty `fi-page` shell, so `mountAction` has no record to resolve
    // and every `assertSee` below matches against markup that never
    // contained an annotation. `loadTable()` is Filament's own helper for
    // exactly this (tables/src/Testing/TestsRecords.php:79) — it is the
    // test-side equivalent of the browser executing that `wire:init`.
    Livewire::actingAs($adminSpeaker)
        ->test(ManageSpeeches::class)
        ->loadTable()
        ->mountAction(TestAction::make('viewAnnotations')->table($speech))
        // `assertMountedActionModalSee`, NOT a plain `assertSee`: the modal
        // is rendered by its own schema component, not inlined into the
        // page snapshot, so `assertSee` matches against the bare `fi-page`
        // shell and fails even when the modal content is perfectly correct.
        // These two assert against the mounted action's own modal render.
        ->assertMountedActionModalSee('PUBLISHED-TEXT')
        ->assertMountedActionModalDontSee('DRAFT-ONLY-TEXT');

    // Hole 7: the audit used to fire on `->action()` (modal SUBMIT), so an
    // admin who opened the modal, read everything and closed it left NO
    // row. `mountAction` is "opened the modal" and nothing more — there is
    // no `callMountedAction` here, and `->modalSubmitAction(false)` means
    // production has no submit button to press either.
    expect(AuditLog::query()->where('action', AuditAction::ADMIN_VIEWED_COMMENTARY)->sole()->subject_id)
        ->toBe($speech->id);
});

it('hole 6: an admin who does NOT own the speech still reads drafts — moderation is not blinded', function () {
    $admin = panelAdmin();
    $coach = panelCoach();
    $speaker = panelMember();

    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $coach->id,
        'speech_owner_id' => $speaker->id,
    ]);
    Annotation::factory()->for($review)->create(['body' => 'DRAFT-ONLY-TEXT', 'published_at' => null]);

    Livewire::actingAs($admin)
        ->test(ManageSpeeches::class)
        ->loadTable()
        ->mountAction(TestAction::make('viewAnnotations')->table($speech))
        ->assertMountedActionModalSee('DRAFT-ONLY-TEXT');
});

// ---------------------------------------------------------------------
// §5.4 hole 3 — coach application approve / reject / document read
// ---------------------------------------------------------------------

it('hole 3: approve is authorized inside the closure', function () {
    $applicant = panelMember();
    $application = panelSubmittedApplication($applicant);

    Livewire::actingAs(panelMember())
        ->test(ManageCoachApplications::class)
        ->callAction(TestAction::make('approve')->table($application), ['reason' => 'Sure.']);

    // The audit row IS written by the service, which is what made this
    // hole so hard to see — `audit_log` showed a well-formed trail of
    // decisions nobody had been authorized to make.
    expect($applicant->fresh()->hasRole(Role::COACH))->toBeFalse()
        ->and($application->fresh()->status)->toBe('submitted')
        ->and(AuditLog::query()->where('action', AuditAction::COACH_APPLICATION_APPROVED)->count())->toBe(0);

    Livewire::actingAs(panelAdmin())
        ->test(ManageCoachApplications::class)
        ->callAction(TestAction::make('approve')->table($application), ['reason' => 'Credentials verified.']);

    expect($applicant->fresh()->hasRole(Role::COACH))->toBeTrue()
        ->and(AuditLog::query()->where('action', AuditAction::COACH_APPLICATION_APPROVED)->count())->toBe(1);
});

it('hole 3: reject is authorized inside the closure too — the Gate is on the capability, not on the outcome', function () {
    // `reject` assigns no role, so it is the half of this hole most easily
    // argued to need no Gate. §4's matrix has ONE row for "approve /
    // reject coach application", and the resource authorizes `role.assign`
    // against the APPLICANT for both verbs: a rejection is still an adverse
    // decision about this person's coach status.
    $applicant = panelMember();
    $application = panelSubmittedApplication($applicant);

    Livewire::actingAs(panelMember())
        ->test(ManageCoachApplications::class)
        ->callAction(TestAction::make('reject')->table($application), ['reason' => 'No reason at all.']);

    expect($application->fresh()->status)->toBe('submitted')
        ->and(AuditLog::query()->where('action', AuditAction::COACH_APPLICATION_REJECTED)->count())->toBe(0);

    Livewire::actingAs(panelAdmin())
        ->test(ManageCoachApplications::class)
        ->callAction(TestAction::make('reject')->table($application), ['reason' => 'Certificates could not be verified.']);

    expect($applicant->fresh()->hasRole(Role::COACH))->toBeFalse()
        ->and(AuditLog::query()->where('action', AuditAction::COACH_APPLICATION_REJECTED)->count())->toBe(1);
});

it('hole 7, second instance: opening the documents modal audits the read on OPEN and links only clean documents', function () {
    // `CoachApplicationResource::viewDocuments` had the same
    // `->action()`-instead-of-`modalContent()` bug as the annotations
    // modal, in a worse variant: the old closure computed a signed URL per
    // document, discarded it (so the click did nothing visible), and still
    // wrote an ADMIN_VIEWED_DOCUMENT row for a document the admin was never
    // shown.
    $application = panelSubmittedApplication(panelMember());
    $clean = panelCleanDocument($application, 'CLEAN-CERTIFICATE.pdf', 'a');

    ApplicationDocument::query()->create([
        'application_id' => $application->id,
        'disk' => 'application_documents',
        'path' => 'documents/pending.pdf',
        'original_filename' => 'PENDING-CERTIFICATE.pdf',
        'byte_size' => 1024,
        'sha256' => str_repeat('b', 64),
        // `pending_scan`, not `pending` — the CHECK constraint is
        // `status IN ('pending_scan','clean','infected')`
        // (2026_08_22_100002_create_application_documents_table.php:43).
        // This row exists to prove `viewDocuments` links ONLY `clean`
        // documents, so an un-scanned one is exactly the fixture needed.
        'status' => 'pending_scan',
    ]);

    Livewire::actingAs(panelAdmin())
        ->test(ManageCoachApplications::class)
        ->loadTable()
        ->mountAction(TestAction::make('viewDocuments')->table($application))
        // Modal-scoped assertions, not page-scoped — see the note on the
        // annotations-modal test above for why `assertSee` matches the
        // bare `fi-page` shell here and reports a false failure.
        ->assertMountedActionModalSee('CLEAN-CERTIFICATE.pdf')
        // A pending (or infected) document is never linkable from this
        // panel, so the scan result is load-bearing and not decoration.
        ->assertMountedActionModalDontSee('PENDING-CERTIFICATE.pdf');

    $audit = AuditLog::query()->where('action', AuditAction::ADMIN_VIEWED_DOCUMENT)->sole();
    expect($audit->subject_id)->toBe($clean->id)
        ->and($audit->metadata['sha256'])->toBe($clean->sha256);
});

// ---------------------------------------------------------------------
// §5.4 hole 4 + §5.7 — report resolve / dismiss
// ---------------------------------------------------------------------

it('hole 4: resolve has a Gate and now writes a REPORT_RESOLVED audit row', function () {
    $speech = Speech::factory()->for(panelMember())->create();
    $report = Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speech->id,
        'state' => 'open',
    ]);

    Livewire::actingAs(panelMember())
        ->test(ManageReports::class)
        ->callAction(TestAction::make('resolve')->table($report), ['resolution_note' => 'Nothing to see.']);

    expect($report->fresh()->state)->toBe('open');

    Livewire::actingAs(panelAdmin())
        ->test(ManageReports::class)
        ->callAction(TestAction::make('resolve')->table($report), ['resolution_note' => 'Speech taken down.']);

    expect($report->fresh()->state)->toBe('actioned');

    // Neither Gate nor audit existed here — `AuditLog` was not even
    // imported, and no `AuditAction` constant covered report resolution
    // until §5.7 added these two.
    $audit = AuditLog::query()->where('action', AuditAction::REPORT_RESOLVED)->sole();
    expect($audit->metadata['resolution_note'])->toBe('Speech taken down.')
        ->and($audit->metadata['reportable_type'])->toBe(Speech::class)
        ->and($audit->metadata['reportable_id'])->toBe($speech->id);
});

it('hole 4: dismiss has a Gate and now writes a REPORT_DISMISSED audit row', function () {
    // ⚠️ `dismiss` authorizes `report.resolve`, NOT `report.dismiss`.
    // `report.dismiss` is not a registered ability, so under §5.7's
    // standing rule (`Gate::before` state 3) it would be an unconditional
    // admin yes — a Gate call that authorizes nothing. The member denial
    // below is what distinguishes the two: an unregistered string would
    // let this member through.
    $speech = Speech::factory()->for(panelMember())->create();
    $report = Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speech->id,
        'state' => 'open',
    ]);

    Livewire::actingAs(panelMember())
        ->test(ManageReports::class)
        ->callAction(TestAction::make('dismiss')->table($report));

    expect($report->fresh()->state)->toBe('open');

    Livewire::actingAs(panelAdmin())
        ->test(ManageReports::class)
        ->callAction(TestAction::make('dismiss')->table($report));

    expect($report->fresh()->state)->toBe('dismissed')
        ->and(AuditLog::query()->where('action', AuditAction::REPORT_DISMISSED)->count())->toBe(1);
});

// ---------------------------------------------------------------------
// §5.4 hole 5 + §5.7 — RoleAssignmentService
// ---------------------------------------------------------------------

it('hole 5: the role allowlist refuses an unknown role string in both directions', function () {
    // Before the allowlist the `$role` argument reached Spatie verbatim,
    // so a typo'd or renamed role threw `RoleDoesNotExist` from INSIDE the
    // transaction with the roster advisory lock already held.
    $admin = panelAdmin();
    $target = panelMember();

    expect(fn () => app(RoleAssignmentService::class)->assign($admin, $target, 'moderator'))
        ->toThrow(InvalidArgumentException::class, "'moderator' is not an assignable role.");

    expect(fn () => app(RoleAssignmentService::class)->revoke($admin, $target, 'moderator'))
        ->toThrow(InvalidArgumentException::class, "'moderator' is not an assignable role.");
});

it('hole 5: `coach` stays assignable — the allowlist must not break the only legal path to that role', function () {
    // §5.4's own warning. `CoachApplicationDecisionService::approve()`
    // calls `assign(..., 'coach')` and `RoleAssignmentServiceTest.php:23`
    // pins it, so an allowlist that forgot `coach` would take the entire
    // coach pipeline down with it.
    $target = panelMember();

    app(RoleAssignmentService::class)->assign(panelAdmin(), $target, Role::COACH);

    expect($target->fresh()->hasRole(Role::COACH))->toBeTrue();
});

it('hole 5: a plain admin cannot grant admin or super_admin, and cannot escalate themselves', function () {
    $admin = panelAdmin();
    $target = panelMember();

    foreach (Role::SUPER_ADMIN_ONLY_GRANTS as $role) {
        expect(captureHttpStatus(fn () => app(RoleAssignmentService::class)->assign($admin, $target, $role)))
            ->toBe(403, "a plain admin must not grant '{$role}'");

        expect(captureHttpStatus(fn () => app(RoleAssignmentService::class)->assign($admin, $admin, $role)))
            ->toBe(403, "a plain admin must not grant themselves '{$role}'");

        expect($target->fresh()->hasRole($role))->toBeFalse();
    }

    // The self-escalation this hole actually enabled: `assign($admin,
    // $admin, 'super_admin')` was a working promotion into the one tier
    // that holds erase, role grants and the audit log.
    expect($admin->fresh()->hasRole(Role::SUPER_ADMIN))->toBeFalse()
        ->and(AuditLog::query()->where('action', AuditAction::ROLE_ASSIGNED)->count())->toBe(0);
});

it('hole 5: the self-check on assign() is separate from the tier check, and answers 422', function () {
    // Probed with `coach` deliberately: `super_admin` hits the 403 tier
    // guard first and never reaches the self-check, so a test written that
    // way would still pass with the self-check deleted.
    $admin = panelAdmin();

    expect(captureHttpStatus(fn () => app(RoleAssignmentService::class)->assign($admin, $admin, Role::COACH)))
        ->toBe(422);

    expect($admin->fresh()->hasRole(Role::COACH))->toBeFalse();
});

it('hole 5: a super_admin CAN grant the administrative roles, and the grant is audited (§5.7)', function () {
    // The control for the 403 above: the tier check has to be a tier check
    // and not a blanket refusal, or §5.3's "there is no path to grant
    // `super_admin` at all" is still true after the fix.
    $superAdmin = panelSuperAdmin();
    $target = panelMember();

    app(RoleAssignmentService::class)->assign($superAdmin, $target, Role::ADMIN);

    expect($target->fresh()->hasRole(Role::ADMIN))->toBeTrue();

    // §5.7: `ROLE_ASSIGNED` was one of four constants with no call site
    // anywhere, and this service did not import `AuditLog` at all. The
    // write lives in the service rather than the caller because
    // `GrantRoleCommand` proves callers that forget exist.
    $audit = AuditLog::query()->where('action', AuditAction::ROLE_ASSIGNED)->sole();
    expect($audit->actor_id)->toBe($superAdmin->id)
        ->and($audit->subject_id)->toBe($target->id)
        ->and($audit->metadata['role'])->toBe(Role::ADMIN);
});

it('hole 5: revoke() has NO self-check — stepping down stays possible while the roster survives', function () {
    // ⚠️ Pinned so it cannot be "tidied" into symmetry with `assign()`.
    // §5.4 put this question to the reviewer and answered it: a self-check
    // here would not merely break `RoleAssignmentServiceTest.php:50-51` and
    // `:65-66`, it would make the last-admin scenario those two exist to
    // pin unreachable. `UserPolicy::revokeSuperAdmin` reaches the same
    // conclusion from the policy side.
    $backup = panelAdmin();
    $admin = panelAdmin();

    app(RoleAssignmentService::class)->revoke($admin, $admin, Role::ADMIN);

    expect($admin->fresh()->hasRole(Role::ADMIN))->toBeFalse()
        ->and($backup->fresh()->hasRole(Role::ADMIN))->toBeTrue();

    // §5.7 again: the ROLE_REVOKED write moved out of
    // `UserResource::revokeCoach` and into the service. Exactly one row —
    // leaving the old call-site write in place as well would log a single
    // revocation twice.
    $audit = AuditLog::query()->where('action', AuditAction::ROLE_REVOKED)->sole();
    expect($audit->metadata['role'])->toBe(Role::ADMIN)
        ->and($audit->actor_id)->toBe($admin->id);
});

it('hole 5 + §5.7: revokeCoach through the panel is gated and writes exactly one audit row', function () {
    // The panel-level seam for the two halves above: `UserResource`'s
    // `Gate::authorize('role.revoke', ...)` plus the service's own audit
    // write, which must not double up now that both exist.
    $coach = panelCoach();

    Livewire::actingAs(panelMember())
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('revokeCoach')->table($coach));

    expect($coach->fresh()->hasRole(Role::COACH))->toBeTrue()
        ->and(AuditLog::query()->where('action', AuditAction::ROLE_REVOKED)->count())->toBe(0);

    Livewire::actingAs(panelAdmin())
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('revokeCoach')->table($coach));

    expect($coach->fresh()->hasRole(Role::COACH))->toBeFalse()
        ->and(AuditLog::query()->where('action', AuditAction::ROLE_REVOKED)->count())->toBe(1);
});

// ---------------------------------------------------------------------
// §5.2 — the super_admin tier, exercised through the panel
// ---------------------------------------------------------------------

it('§5.2: a super_admin can moderate through the panel, not merely clear its front door', function () {
    // `AdminAbilityDenialTest` proves the Gate answers `true` for a
    // super_admin. This proves that answer is reached through the panel's
    // own closures, which is where §1.2's split actually bit: a super_admin
    // cleared `EnsureUserIsAdmin`, got the whole UI, and was then refused
    // by every policy behind it.
    Notification::fake();
    Bus::fake();
    $superAdmin = panelSuperAdmin();
    $speech = Speech::factory()->for(panelMember())->create();
    $report = Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speech->id,
        'state' => 'open',
    ]);

    Livewire::actingAs($superAdmin)
        ->test(ManageSpeeches::class)
        ->callAction(TestAction::make('takedown')->table($speech), ['reason' => 'Reviewed by the senior tier.']);

    Livewire::actingAs($superAdmin)
        ->test(ManageReports::class)
        ->callAction(TestAction::make('resolve')->table($report), ['resolution_note' => 'Speech taken down.']);

    expect($speech->fresh()->trashed())->toBeTrue()
        ->and($report->fresh()->state)->toBe('actioned')
        ->and(AuditLog::query()->where('actor_id', $superAdmin->id)->count())->toBe(2);
});

it('§5.2: a super_admin suspends through the panel, where the tier split used to deny them', function () {
    Notification::fake();
    $superAdmin = panelSuperAdmin();
    $target = panelMember();

    Livewire::actingAs($superAdmin)
        ->test(ManageUsers::class)
        ->callAction(TestAction::make('toggleSuspend')->table($target), ['reason' => 'Repeated abuse reports.']);

    expect($target->fresh()->suspended_at)->not->toBeNull()
        ->and(AuditLog::query()->where('action', AuditAction::USER_SUSPENDED)->sole()->actor_id)
        ->toBe($superAdmin->id);

    Notification::assertSentTo($target, AccountSuspended::class);
});

// ---------------------------------------------------------------------
// §8.3 — the two modal blades, which rendered fully unstyled
// ---------------------------------------------------------------------

it('§8.3: neither modal blade uses a Tailwind utility class, because this panel serves no compiled Tailwind', function () {
    // The constraint that stands from §8.3: `api/` declares a Tailwind
    // toolchain in package.json but has no `node_modules` and no
    // `public/build`, and the Dockerfile's `webbuild` stage builds `web/`
    // only. None of the 15 utility classes these two files used exists as
    // a selector in the compiled `filament/dist/theme.css` that IS served,
    // so both modals rendered as unstyled divs — the bordered, hoverable
    // rows their markup described had never once existed on screen.
    //
    // Rendered directly rather than asserted against the full page HTML:
    // the page is overwhelmingly Filament's own markup, so an
    // `assertDontSee` over all of it would be measuring the framework
    // instead of these two files.
    $coach = panelCoach();
    $speaker = panelMember();
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $coach->id,
        'speech_owner_id' => $speaker->id,
    ]);
    $annotation = Annotation::factory()->for($review)->create(['published_at' => now()]);

    $annotations = view('filament.speech-annotations-by-reviewer', [
        'groups' => collect([
            // Full group shape, matching `SpeechResource::commentaryGroups()`:
            // §6.3 added `audio` (presigned voice-note URLs) and `essays`
            // (published, read-time-sanitized HTML) alongside the original
            // two keys. Kept empty here because this test is the §8.3
            // stylesheet guard — it asserts the blade emits no Tailwind
            // utility class, and the media branches are covered by
            // AdminMediaReviewTest. They must still be PRESENT, or the
            // view renders against a shape production never passes it.
            $coach->id => [
                'reviewer' => $coach,
                'annotations' => collect([$annotation]),
                'audio' => [],
                'essays' => collect(),
            ],
        ]),
    ])->render();

    $application = panelSubmittedApplication($speaker);
    $documents = view('filament.coach-application-documents', [
        'documents' => collect([[
            'document' => panelCleanDocument($application, 'certificate.pdf', 'c'),
            'url' => 'https://example.test/signed',
        ]]),
    ])->render();

    // The empty branches are the likeliest to rot unnoticed — nothing in
    // the panel renders them once a queue has rows in it.
    $emptyAnnotations = view('filament.speech-annotations-by-reviewer', ['groups' => collect()])->render();
    $emptyDocuments = view('filament.coach-application-documents', ['documents' => collect()])->render();

    // Every utility class §8.3 names, across both files.
    $utilities = [
        'space-y-2', 'space-y-4', 'rounded-lg', 'border-gray-200', 'hover:bg-gray-50',
        'dark:border-gray-700', 'dark:hover:bg-gray-800', 'items-center', 'justify-between',
        'text-gray-500', 'font-semibold', 'list-disc', 'text-sm', 'text-xs', 'mt-2', 'pl-5', 'p-3',
    ];

    foreach ([$annotations, $documents, $emptyAnnotations, $emptyDocuments] as $html) {
        foreach ($utilities as $utility) {
            expect($html)->not->toContain($utility);
        }
    }

    // The positive half: the Filament components really are there. Without
    // it, an empty render would satisfy the loop above.
    expect($annotations)->toContain('fi-section')
        ->and($documents)->toContain('fi-link')
        ->and($emptyAnnotations)->toContain('fi-empty-state')
        ->and($emptyDocuments)->toContain('fi-empty-state');
});
