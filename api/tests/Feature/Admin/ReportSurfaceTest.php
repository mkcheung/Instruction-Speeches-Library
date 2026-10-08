<?php

use App\Filament\Resources\ReportResource\Pages\ManageReports;
use App\Models\Report;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Support\Role;
use Database\Seeders\RoleSeeder;
use Filament\Actions\Testing\TestAction;
use Filament\Facades\Filament;
use Filament\Tables\Table;
use Illuminate\Support\Str;
use Livewire\Livewire;

/**
 * PLAN-ADMIN-DASHBOARD.md §6.4 — "Reports — add the missing context".
 *
 * §6.4's premise is a claim about what an admin can SEE, so every
 * assertion below reads rendered markup rather than model state. That is
 * the only way this section can be tested: the four columns
 * `ReportResource` shipped with (`reportable_type`, `reason`, `state`,
 * `created_at`) were each individually correct, and the defect was the
 * absence of two others. Nothing about the `reports` table or the
 * `Report` model changed to close it, so a test asserting on data would
 * pass identically before and after.
 *
 * Driven through Livewire rather than HTTP for the reason
 * `PanelModerationTest`'s own header gives: `EnsureUserIsAdmin` guards
 * the ROUTE, and what matters here is the behaviour of closures BEHIND
 * that guard. The member-denial test at the bottom is only meaningful
 * because it skips the middleware.
 *
 * ⚠️ Deliberately separate from `PanelModerationTest.php`. That file is
 * §5.4's eight-hole ledger — "keeping the plan's coverage in one place is
 * what makes 'all eight are closed' checkable" — and its two report tests
 * pin the Gate + audit on `resolve`/`dismiss`, which §6.4 does not touch.
 * Helper names here are prefixed `reportSurface*` so both files can be
 * loaded in one Pest run without redeclaring anything.
 */
beforeEach(function () {
    $this->seed(RoleSeeder::class);
    Filament::setCurrentPanel('admin');
    reportSurfaceTableWithoutIntl();
});

/**
 * ⚠️ ENVIRONMENT, not a convenience — the long-form reasoning lives in
 * `PanelModerationTest::renderPanelTablesWithoutIntl()` and is not
 * repeated here. The short version: `filament/support` requires
 * `ext-intl` and this dev host has none, so
 * `support/components/pagination/index.blade.php:51-53` throws
 * `RuntimeException: The "intl" PHP extension is required to use the
 * [format] method` out of `Illuminate\Support\Number::format()` on EVERY
 * table render. `paginated(false)` removes the pagination component
 * outright (it is wrapped in `@if ($hasPagination)`), which is also the
 * honest configuration for a three-row fixture.
 *
 * `ManageReports` needs only this lever and not the sibling
 * `deferLoading()` one: that second workaround exists for
 * `$allSelectableRecordsCount` in the select-all indicator, which
 * renders only when `$isSelectionEnabled`, and `ReportResource` declares
 * no `BulkAction`. Deferring here would be actively wrong — these tests
 * read table cells and a mounted modal body, both of which render as
 * nothing under `deferLoading()`.
 */
function reportSurfaceTableWithoutIntl(): void
{
    Table::configureUsing(function (Table $table): void {
        $table->paginated(false);
    });
}

/**
 * ⚠️ THE `username` ARGUMENT IS LOAD-BEARING WHEREVER A TEST ASSERTS ON
 * IT. `UserFactory::definition()` sets `'username' => null` — explicitly,
 * with its own comment about `preventAccessingMissingAttributes()` — so
 * `assertSee($user->username)` is `assertSee(null)`, which coerces to the
 * empty string and passes against literally any markup. Several
 * assertions below looked green that way before this helper existed. Any
 * test that cares who a reporter/speaker/reviewer is passes a distinctive
 * literal and asserts on that literal, never on the attribute.
 *
 * `username` is `string(30)` and `unique()`, hence the random default for
 * the fixtures that do not care: two bare `reportSurfaceAdmin()` calls in
 * one test (the resolution test needs exactly that) would otherwise
 * collide on a shared constant.
 */
function reportSurfaceUser(string $role, ?string $username = null): User
{
    $user = User::factory()->create(['username' => $username ?? 'u'.Str::lower(Str::random(12))]);
    $user->assignRole($role);

    return $user;
}

function reportSurfaceAdmin(?string $username = null): User
{
    return reportSurfaceUser(Role::ADMIN, $username);
}

function reportSurfaceSuperAdmin(?string $username = null): User
{
    return reportSurfaceUser(Role::SUPER_ADMIN, $username);
}

function reportSurfaceMember(?string $username = null): User
{
    return reportSurfaceUser(Role::MEMBER, $username);
}

// ---------------------------------------------------------------------
// §6.4 additions 1 + 2 — `detail` and the reporter
// ---------------------------------------------------------------------

it('shows the reporter free text and the reporter, neither of which had a column', function () {
    $reporter = reportSurfaceMember('reporter-alice');
    $speech = Speech::factory()->for(reportSurfaceMember())->create(['title' => 'REPORTED-SPEECH-TITLE']);

    Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speech->id,
        'reporter_id' => $reporter->id,
        // Short on purpose: the queue column truncates at 60 characters
        // (`detail` is a VARCHAR(500) of free text), so a fixture longer
        // than that would be asserting the truncation rather than the
        // field. The modal test below covers the untruncated path.
        'detail' => 'DETAIL-FREE-TEXT',
        'state' => 'open',
    ]);

    Livewire::actingAs(reportSurfaceAdmin())
        ->test(ManageReports::class)
        ->loadTable()
        // §6.4: `detail` is "in `$fillable` but not in the columns — the
        // single most useful field". This is the assertion that it is now
        // in the columns.
        ->assertSee('DETAIL-FREE-TEXT')
        ->assertSee('reporter-alice');
});

it('falls back to a placeholder when the report has no detail and its reporter was erased', function () {
    // Both columns are nullable at the schema level, for unrelated
    // reasons: `detail` is optional on the API request, while
    // `reporter_id` is `ON DELETE SET NULL` because (the migration's own
    // words) "a report must survive the reporter's account being erased
    // later". A blank cell would read as a rendering failure for either.
    $speech = Speech::factory()->for(reportSurfaceMember())->create();

    Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speech->id,
        'reporter_id' => null,
        'detail' => null,
        'state' => 'open',
    ]);

    Livewire::actingAs(reportSurfaceAdmin())
        ->test(ManageReports::class)
        ->loadTable()
        ->assertSee('none given')
        ->assertSee('account erased');
});

// ---------------------------------------------------------------------
// §6.4 addition 3 — the deep link, polymorphic over Speech and Review
// ---------------------------------------------------------------------

it('deep-links a speech report to the Speeches resource, by title', function () {
    $speaker = reportSurfaceMember('speaker-bob');
    $speech = Speech::factory()->for($speaker)->create(['title' => 'DEEP-LINK-SPEECH']);

    Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speech->id,
        'state' => 'open',
    ]);

    Livewire::actingAs(reportSurfaceAdmin())
        ->test(ManageReports::class)
        ->loadTable()
        // The identity §6.4 says an admin "cannot tell": title and
        // speaker, where this table previously showed the literal string
        // `App\Models\Speech` and nothing else.
        ->assertSee('DEEP-LINK-SPEECH')
        ->assertSee('@speaker-bob')
        // The link itself, asserted as raw markup because it lives in an
        // `href`. Both halves are load-bearing: `/speeches` pins it to
        // the RESOURCE rather than to one of `SpeechResource`'s five
        // record actions, and `search=` pins it to the query-string alias
        // Filament binds `$tableSearch` to (`#[Url(as: 'search')]`) —
        // the only mechanism that can narrow a `ManageRecords` page to
        // one row, since that resource has no `view` page to link to.
        ->assertSeeHtml('/control-panel/speeches?search=DEEP-LINK-SPEECH');
});

it('renders a review report with enough context to identify it, and links to its parent speech', function () {
    // `Report::REPORTABLE_TYPES` resolves `Review` as well as `Speech`,
    // and there is no Filament resource for `Review` — so §6.4's "surface
    // enough context to identify it (speech title, reviewer)" is the
    // whole requirement, plus a link to the speeches table, which is
    // where `viewAnnotations` can actually show the reported commentary.
    $speaker = reportSurfaceMember();
    $coach = reportSurfaceMember('reviewer-carol');
    $speech = Speech::factory()->for($speaker)->create(['title' => 'REVIEWED-SPEECH']);

    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $coach->id,
        'speech_owner_id' => $speaker->id,
    ]);

    Report::factory()->create([
        'reportable_type' => Review::class,
        'reportable_id' => $review->id,
        'state' => 'open',
    ]);

    Livewire::actingAs(reportSurfaceAdmin())
        ->test(ManageReports::class)
        ->loadTable()
        ->assertSee('Review #'.$review->id)
        ->assertSee('@reviewer-carol')
        ->assertSee('REVIEWED-SPEECH')
        ->assertSeeHtml('/control-panel/speeches?search=REVIEWED-SPEECH');
});

// ---------------------------------------------------------------------
// §6.4 — the reportable may not be there any more
// ---------------------------------------------------------------------

it('renders a report whose speech was taken down, and says so', function () {
    // ⚠️ The regression this test exists for. `Speech` uses
    // `SoftDeletes`, so `$report->reportable` resolves through the
    // default global scope and returns **null** for a taken-down speech
    // — which is the most likely state of a reported speech by the time
    // a second admin opens the queue. A `reportable->title` read would
    // therefore 500 on the happy path of a two-admin workflow, so
    // `reportableContext()` queries `Speech::withTrashed()` by primary
    // key and never touches the relation.
    $speaker = reportSurfaceMember('speaker-dina');
    $speech = Speech::factory()->for($speaker)->create(['title' => 'TRASHED-SPEECH']);

    Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speech->id,
        'state' => 'open',
    ]);

    $speech->delete();

    // The precondition this test turns on, pinned so a later change to
    // `Speech`'s delete semantics cannot quietly make the rest of it
    // vacuous. `Model::fresh()` is NOT usable for this — it queries
    // without global scopes and returns the trashed row happily;
    // `Speech::query()->find()` is the read that goes through the
    // SoftDeletes scope, which is the read `$report->reportable` makes.
    expect(Speech::query()->find($speech->id))->toBeNull();

    Livewire::actingAs(reportSurfaceAdmin())
        ->test(ManageReports::class)
        ->loadTable()
        ->assertSuccessful()
        ->assertSee('TRASHED-SPEECH')
        ->assertSee('@speaker-dina')
        // Not decoration: "someone has already actioned this" is the
        // single most decision-changing fact a queue row can carry. The
        // deep link still works because `SpeechResource`'s table loads
        // trashed rows on purpose.
        ->assertSee('(TAKEN DOWN)')
        ->assertSeeHtml('/control-panel/speeches?search=TRASHED-SPEECH');
});

it('renders a tombstone for a hard-deleted reportable instead of erroring', function () {
    // `PurgeSpeechMedia` (after §5.6's quarantine window) and
    // `PrivacyEraseCommand` both hard-delete, and `reports` has no FK to
    // `speeches` — the bare morph pair is deliberate — so the report row
    // outlives its target with a dangling id. An empty cell here would
    // read as "nothing was reported"; printing the id is what keeps the
    // row auditable against `audit_log`, which records the same pair.
    $speech = Speech::factory()->for(reportSurfaceMember())->create();
    $speechId = $speech->id;

    Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speechId,
        'state' => 'open',
    ]);

    $speech->forceDelete();

    Livewire::actingAs(reportSurfaceAdmin())
        ->test(ManageReports::class)
        ->loadTable()
        ->assertSuccessful()
        ->assertSee("Speech #{$speechId} (no longer exists)");
});

it('renders a tombstone for a deleted review', function () {
    // `Review` never soft-deletes, so a review report's target is either
    // present or gone outright — there is no middle state to render.
    $speaker = reportSurfaceMember();
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => reportSurfaceMember()->id,
        'speech_owner_id' => $speaker->id,
    ]);
    $reviewId = $review->id;

    Report::factory()->create([
        'reportable_type' => Review::class,
        'reportable_id' => $reviewId,
        'state' => 'open',
    ]);

    $review->delete();

    Livewire::actingAs(reportSurfaceAdmin())
        ->test(ManageReports::class)
        ->loadTable()
        ->assertSuccessful()
        ->assertSee("Review #{$reviewId} (no longer exists)");
});

it('renders a review report whose parent speech was taken down', function () {
    // ⚠️ The review equivalent of the trashed-speech case above, and a
    // DIFFERENT bug: `Review::$speech` is documented as resolving to
    // **null for a trashed speech** — its `@property-read` override says
    // so explicitly and names the admin takedown path as the cause — so
    // `$review->speech->title` would 500 here. `reportableContext()`
    // reads `Speech::withTrashed()->find($review->speech_id)` instead,
    // which is what keeps both the title and the deep link alive.
    //
    // The remaining branch — a review whose speech is HARD-gone — is
    // required by `find()`'s nullable return type but unreachable in
    // practice: `reviews.speech_id` is `ON DELETE CASCADE`, so a
    // force-deleted speech takes its reviews with it and such a report
    // lands in the "Review no longer exists" case above instead.
    $speaker = reportSurfaceMember();
    $coach = reportSurfaceMember('reviewer-evan');
    $speech = Speech::factory()->for($speaker)->create(['title' => 'TRASHED-PARENT-SPEECH']);
    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $coach->id,
        'speech_owner_id' => $speaker->id,
    ]);

    Report::factory()->create([
        'reportable_type' => Review::class,
        'reportable_id' => $review->id,
        'state' => 'open',
    ]);

    $speech->delete();

    Livewire::actingAs(reportSurfaceAdmin())
        ->test(ManageReports::class)
        ->loadTable()
        ->assertSuccessful()
        ->assertSee('Review #'.$review->id)
        ->assertSee('@reviewer-evan')
        ->assertSee('TRASHED-PARENT-SPEECH')
        ->assertSee('(TAKEN DOWN)')
        ->assertSeeHtml('/control-panel/speeches?search=TRASHED-PARENT-SPEECH');
});

it('names an unrecognised reportable type rather than rendering a blank cell', function () {
    // `reports.reportable_type` is the one enumerated-looking column on
    // this table with NO CHECK constraint (`reason` and `state` both have
    // one), so only `ReportController` narrows it to
    // `REPORTABLE_TYPES`. A seeder, a console command, or a reportable
    // type added to the API but not to `ReportResource` lands here — and
    // §11.4's open question (should `User` be reportable?) is exactly the
    // change that would produce one.
    Report::factory()->create([
        'reportable_type' => 'App\Models\Nonexistent',
        'reportable_id' => 4242,
        'state' => 'open',
    ]);

    Livewire::actingAs(reportSurfaceAdmin())
        ->test(ManageReports::class)
        ->loadTable()
        ->assertSuccessful()
        ->assertSee('Unrecognised report target');
});

// ---------------------------------------------------------------------
// §6.4 addition 4 — the context modal
// ---------------------------------------------------------------------

it('the context modal carries reporter, reportable, reason, detail, state and the resolution', function () {
    $reporter = reportSurfaceMember('reporter-frank');
    $speaker = reportSurfaceMember('speaker-grace');
    $resolver = reportSurfaceAdmin('resolver-heidi');
    $speech = Speech::factory()->for($speaker)->create(['title' => 'MODAL-CONTEXT-SPEECH']);

    $report = Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speech->id,
        'reporter_id' => $reporter->id,
        'reason' => 'harassment',
        // Longer than the queue column's 60-character limit on purpose:
        // the modal is the surface that has to show it whole, and a
        // fixture short enough to survive truncation would not prove it.
        'detail' => 'MODAL-DETAIL-OPENING plus a great deal of additional explanation from the reporter, running well past sixty characters and ending at MODAL-DETAIL-CLOSING',
        'state' => 'actioned',
        'resolved_by_id' => $resolver->id,
        'resolved_at' => now(),
        'resolution_note' => 'MODAL-RESOLUTION-NOTE',
    ]);

    Livewire::actingAs(reportSurfaceAdmin())
        ->test(ManageReports::class)
        // `loadTable()` first: Filament v4 renders the table shell with
        // `wire:init="loadTable"` and fills it on a follow-up round trip,
        // so without this `mountAction` has no record to resolve.
        ->loadTable()
        ->mountAction(TestAction::make('viewContext')->table($report))
        // `assertMountedActionModalSee`, NOT `assertSee`: the modal is
        // rendered by its own schema component rather than inlined into
        // the page snapshot, so a plain `assertSee` matches the bare
        // `fi-page` shell and reports a false failure.
        ->assertMountedActionModalSee('reporter-frank')
        ->assertMountedActionModalSee('MODAL-CONTEXT-SPEECH')
        ->assertMountedActionModalSee('@speaker-grace')
        ->assertMountedActionModalSee('harassment')
        ->assertMountedActionModalSee('MODAL-DETAIL-OPENING')
        ->assertMountedActionModalSee('MODAL-DETAIL-CLOSING')
        ->assertMountedActionModalSee('actioned')
        // The three columns `resolve` has written since STEP-12 and
        // nothing in the panel has ever read back, which is what makes an
        // appeal reviewable from the queue it was closed in.
        ->assertMountedActionModalSee('resolver-heidi')
        ->assertMountedActionModalSee('MODAL-RESOLUTION-NOTE');
});

it('the context modal opens for an already-resolved report, which is what an appeal looks like', function () {
    // No `visible()` state gate on `viewContext`, deliberately —
    // `resolve`/`dismiss` are hidden once `state !== 'open'` because they
    // would be no-ops, but re-READING a closed report is the one thing a
    // moderator needs most after the fact.
    $speech = Speech::factory()->for(reportSurfaceMember())->create();
    $report = Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speech->id,
        'detail' => 'DISMISSED-REPORT-DETAIL',
        'state' => 'dismissed',
        'resolved_at' => now(),
    ]);

    Livewire::actingAs(reportSurfaceAdmin())
        ->test(ManageReports::class)
        ->loadTable()
        ->mountAction(TestAction::make('viewContext')->table($report))
        ->assertMountedActionModalSee('DISMISSED-REPORT-DETAIL')
        // `resolved_by_id` is null on this row — a dismissal recorded by
        // something other than the panel leaves it so — and the
        // placeholder has to render rather than a blank entry.
        ->assertMountedActionModalSee('still open');
});

it('the context modal survives a trashed and a hard-deleted reportable', function () {
    $trashedSpeech = Speech::factory()->for(reportSurfaceMember())->create(['title' => 'MODAL-TRASHED-SPEECH']);
    $trashedReport = Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $trashedSpeech->id,
        'state' => 'open',
    ]);
    $trashedSpeech->delete();

    $goneSpeech = Speech::factory()->for(reportSurfaceMember())->create();
    $goneSpeechId = $goneSpeech->id;
    $goneReport = Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $goneSpeechId,
        'state' => 'open',
    ]);
    $goneSpeech->forceDelete();

    Livewire::actingAs(reportSurfaceAdmin())
        ->test(ManageReports::class)
        ->loadTable()
        ->mountAction(TestAction::make('viewContext')->table($trashedReport))
        ->assertMountedActionModalSee('MODAL-TRASHED-SPEECH')
        ->assertMountedActionModalSee('(TAKEN DOWN)')
        ->unmountAction()
        ->mountAction(TestAction::make('viewContext')->table($goneReport))
        ->assertMountedActionModalSee("Speech #{$goneSpeechId} (no longer exists)");
});

// ---------------------------------------------------------------------
// §6.4 / §1.2 / §8.2 — who may open the context modal
// ---------------------------------------------------------------------

it('both admin tiers reach the context modal', function () {
    // §5.2 collapsed every admin check in this panel onto
    // `Role::ADMIN_TIER`. Asserted for both roles because §6.3 records
    // the opposite bug shipping once already: `Gate::before` tested
    // `hasRole('admin')` exactly, so a `super_admin` was refused a
    // surface a plain `admin` could use.
    $speech = Speech::factory()->for(reportSurfaceMember())->create();
    $report = Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speech->id,
        'detail' => 'TIER-VISIBLE-DETAIL',
        'state' => 'open',
    ]);

    foreach ([reportSurfaceAdmin(), reportSurfaceSuperAdmin()] as $actor) {
        Livewire::actingAs($actor)
            ->test(ManageReports::class)
            ->loadTable()
            ->mountAction(TestAction::make('viewContext')->table($report))
            ->assertMountedActionModalSee('TIER-VISIBLE-DETAIL');
    }
});

it('a member is refused the context modal — the guard is in the closure, not in visible()', function () {
    // ⚠️ Not a reachable production state: `EnsureUserIsAdmin` 403s the
    // `/control-panel` route first. It is the only way to prove the
    // refusal lives INSIDE the action, which is the property §6.4 needs
    // and the property a `ViewAction` would NOT have provided — see
    // `ReportResource::contextEntries()`: `ReportPolicy` has no `view`
    // method, so Filament's resource authorization falls through
    // `Gate::before` to the framework's `Response::allow()` default
    // (§1.2) and a member would have been let straight in.
    //
    // ⚠️ `assertForbidden()`, NOT `expect(...)->toThrow(HttpException)`.
    // A Livewire component test does not re-throw an `abort()` the way a
    // service-level test does:
    // `SupportTesting\RequestBroker::temporarilyDisableExceptionHandlingAndMiddleware()`
    // calls `withoutExceptionHandling([HttpException::class,
    // AuthorizationException::class])` — it deliberately EXEMPTS those
    // two classes from the rethrow, so they are rendered into a real 403
    // response and `SubsequentRender` hands back an empty
    // `ComponentState` instead. `Testable::__call()` forwards unknown
    // methods to the underlying `TestResponse`, which is what makes the
    // status assertable here at all. A `toThrow()` assertion would fail
    // with "nothing was thrown" while the guard worked perfectly, and
    // the tempting conclusion from that is that the guard is missing.
    $speech = Speech::factory()->for(reportSurfaceMember())->create();
    $report = Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speech->id,
        'detail' => 'MEMBER-MUST-NOT-SEE',
        'state' => 'open',
    ]);

    Livewire::actingAs(reportSurfaceMember())
        ->test(ManageReports::class)
        ->loadTable()
        ->mountAction(TestAction::make('viewContext')->table($report))
        ->assertForbidden();
});

// ---------------------------------------------------------------------
// §6.4 — "keep the queue oldest-first and keep the state filter"
// ---------------------------------------------------------------------

it('keeps the queue oldest-first and keeps the state filter', function () {
    // Oldest-first is what `reports_state_created_at_index` was built to
    // serve, and the state filter is the other half of that index. Both
    // predate §6.4; this test exists because §6.4 rewrites the whole
    // `columns()`/`modifyQueryUsing()` block around them, and silently
    // dropping either would turn a queue back into a pile.
    $speech = Speech::factory()->for(reportSurfaceMember())->create();

    $oldest = Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speech->id,
        'detail' => 'OLDEST-REPORT',
        'state' => 'open',
        'created_at' => now()->subDays(3),
    ]);

    $newest = Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speech->id,
        'detail' => 'NEWEST-REPORT',
        'state' => 'open',
        'created_at' => now(),
    ]);

    $closed = Report::factory()->create([
        'reportable_type' => Speech::class,
        'reportable_id' => $speech->id,
        'detail' => 'CLOSED-REPORT',
        'state' => 'dismissed',
        'created_at' => now()->subDay(),
    ]);

    Livewire::actingAs(reportSurfaceAdmin())
        ->test(ManageReports::class)
        ->loadTable()
        ->assertCanSeeTableRecords([$oldest, $closed, $newest], inOrder: true)
        ->filterTable('state', 'open')
        ->assertCanSeeTableRecords([$oldest, $newest])
        ->assertCanNotSeeTableRecords([$closed]);
});
