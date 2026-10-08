<?php

use App\Filament\Resources\SpeechResource;
use App\Filament\Resources\SpeechResource\Pages\ManageSpeeches;
use App\Models\AuditLog;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Models\User;
use App\Support\AuditAction;
use App\Support\Role;
use Database\Seeders\RoleSeeder;
use Filament\Actions\Testing\TestAction;
use Filament\Facades\Filament;
use Filament\Tables\Table;
use Livewire\Livewire;

/**
 * PLAN-ADMIN-DASHBOARD.md §6.3 — admin media review.
 *
 * This file exists mainly for ONE assertion: that `viewVideo` refuses a
 * TAKEN-DOWN speech. Everything else here is supporting cast.
 *
 * Why that one matters more than the rest. §1.3 established three facts
 * that compound:
 *
 *   1. A takedown is a SOFT delete, so every byte survives in the bucket.
 *   2. The object path is `speeches/{ulid}/{ulid}/720p.mp4` — derivable
 *      from the ULID alone, because the intended `playback_key` segment
 *      was never built (that column has one write site and ZERO reads).
 *   3. `MediaUrlSigner::presign()` enforces NO authorization whatsoever;
 *      it is a pure `(path, ttl) -> URL` function, so any code path that
 *      reaches it with a path yields a working link.
 *
 * And this table deliberately loads trashed rows (`withTrashed()`), so a
 * takedown is reviewable at all. Put together: an admin-playback action
 * that forgot to check `trashed()` would hand out a live, unrevocable,
 * hour-long bearer URL for content that was taken down — and §1.3 proves
 * nothing in this codebase can revoke it afterwards.
 *
 * ⚠️ `visible()` is NOT a sufficient guard, so the refusal is asserted at
 * BOTH layers rather than only through the UI:
 *
 *   - Layer 1, the affordance — `assertActionHidden`, i.e. no Watch button
 *     on a taken-down or not-yet-ready row.
 *   - Layer 2, the real guard — `SpeechResource::playableVideo()` returns
 *     null, checked directly via a test seam.
 *
 * Layer 2 is the one that matters, because
 * `InteractsWithActions::mountAction()` consults `isDisabled()` and never
 * `isVisible()`: a hidden record action is still mountable by a crafted
 * Livewire request. An affordance-only gate would therefore hand out a
 * live URL to anyone willing to skip the button — which is exactly the
 * threat model here, since the bytes survive takedown and the link cannot
 * be revoked. Asserting layer 2 against the predicate rather than through
 * the UI is deliberate: the UI is the layer being bypassed, so driving it
 * could not detect the failure.
 */
function mediaAdmin(): User
{
    $user = User::factory()->create();
    $user->assignRole(Role::ADMIN);

    return $user;
}

function mediaSuperAdmin(): User
{
    $user = User::factory()->create();
    $user->assignRole(Role::SUPER_ADMIN);

    return $user;
}

function mediaSpeaker(): User
{
    $user = User::factory()->create();
    $user->assignRole(Role::MEMBER);

    return $user;
}

/** A speech with a ready, primary 720p rendition — the playable shape. */
function mediaPlayableSpeech(): Speech
{
    $speech = Speech::factory()->for(mediaSpeaker())->create();

    SpeechAsset::factory()->video()->ready()->create(['speech_id' => $speech->id]);

    return $speech;
}

beforeEach(function () {
    $this->seed(RoleSeeder::class);

    // Required: no panel is "current" outside an HTTP request through the
    // panel's own middleware, and `Livewire::test()` bypasses that. Same
    // reasoning (and the same call) as `PanelModerationTest`.
    Filament::setCurrentPanel('admin');

    // `paginated(false)` sidesteps this dev host's missing `ext-intl`,
    // which `filament/support` requires and which every paginated table
    // render touches. See `PanelModerationTest`'s own long note on why
    // that gap is local-only (the production image installs intl) and why
    // it is registered per test rather than once per process.
    Table::configureUsing(fn (Table $table) => $table->paginated(false));
});

// ---------------------------------------------------------------------
// The load-bearing refusal
// ---------------------------------------------------------------------

it('refuses video playback for a taken-down speech, mints no URL and writes no audit row', function () {
    $speech = mediaPlayableSpeech();
    $speech->delete();

    expect($speech->fresh()->trashed())->toBeTrue();

    Livewire::actingAs(mediaAdmin())
        ->test(ManageSpeeches::class)
        ->loadTable()
        // Layer 1, the affordance: no Watch button on a taken-down row.
        ->assertActionHidden(TestAction::make('viewVideo')->table($speech));

    // The two halves that actually matter: no bearer token was handed
    // out, and the audit trail does not claim a view that never happened.
    expect(AuditLog::query()->where('action', AuditAction::ADMIN_VIEWED_SPEECH)->count())->toBe(0);

    // Layer 2, defence in depth: `playableVideo()` re-checks `trashed()`
    // at GENERATION time, independently of `visible()`. That second check
    // is the one that actually matters, because
    // `InteractsWithActions::mountAction()` consults `isDisabled()` and
    // never `isVisible()` — a hidden record action is still mountable by
    // a crafted Livewire request, so an affordance-only gate would hand
    // out an unrevocable hour-long URL for taken-down bytes. Asserted
    // directly against the predicate rather than through the UI, since
    // the UI is precisely the layer being bypassed.
    expect(SpeechResource::playableVideoForTesting($speech->fresh()))->toBeNull();
});

it('refuses video playback when the rendition is not ready — status is the only readiness signal', function () {
    // §9.4 rule 3: readiness is `status`, never "a path exists". A
    // queued-but-unprocessed row already has a path, so signing on path
    // presence would serve a zero-byte or partial object.
    $speech = Speech::factory()->for(mediaSpeaker())->create();
    SpeechAsset::factory()->video()->create([
        'speech_id' => $speech->id,
        'status' => 'processing',
        'is_primary' => true,
    ]);

    Livewire::actingAs(mediaAdmin())
        ->test(ManageSpeeches::class)
        ->loadTable()
        ->assertActionHidden(TestAction::make('viewVideo')->table($speech));

    expect(AuditLog::query()->where('action', AuditAction::ADMIN_VIEWED_SPEECH)->count())->toBe(0)
        ->and(SpeechResource::playableVideoForTesting($speech->fresh()))->toBeNull();
});

it('plays a ready video and audits the view on modal OPEN', function () {
    $speech = mediaPlayableSpeech();

    Livewire::actingAs($admin = mediaAdmin())
        ->test(ManageSpeeches::class)
        ->loadTable()
        ->mountAction(TestAction::make('viewVideo')->table($speech));

    // Audited on OPEN, not on submit — the §5.4 hole-7 bug class, which
    // this codebase shipped twice. `->modalSubmitAction(false)` means
    // there is no submit path to audit from in the first place.
    $audit = AuditLog::query()->where('action', AuditAction::ADMIN_VIEWED_SPEECH)->sole();

    expect($audit->actor_id)->toBe($admin->id)
        ->and($audit->subject_id)->toBe($speech->id)
        ->and($audit->metadata['ttl_seconds'])->toBe(3600);
});

// ---------------------------------------------------------------------
// Transcript — the surface that needed no new authorization
// ---------------------------------------------------------------------

it('reads the transcript of a TAKEN-DOWN speech, which the public API refuses', function () {
    // The API 410s on a trashed speech (`SpeechDeletedException`), which
    // is exactly when a moderator reviewing the takedown or an appeal
    // most needs to read what was said. The panel queries `withTrashed()`
    // directly for that reason.
    $speech = mediaPlayableSpeech();
    SpeechTranscript::factory()->create([
        'speech_id' => $speech->id,
        'body' => 'TRANSCRIBED-SPEECH-BODY',
    ]);
    $speech->delete();

    Livewire::actingAs(mediaAdmin())
        ->test(ManageSpeeches::class)
        ->loadTable()
        ->mountAction(TestAction::make('viewTranscript')->table($speech))
        ->assertMountedActionModalSee('TRANSCRIBED-SPEECH-BODY');
});

it('says so plainly when a speech has no transcript rather than rendering an empty modal', function () {
    $speech = mediaPlayableSpeech();

    Livewire::actingAs(mediaAdmin())
        ->test(ManageSpeeches::class)
        ->loadTable()
        ->mountAction(TestAction::make('viewTranscript')->table($speech))
        ->assertMountedActionModalSee('No transcript');
});

// ---------------------------------------------------------------------
// Both admin tiers — §5.2 made super_admin a real superset
// ---------------------------------------------------------------------

it('grants a super_admin the same media review as an admin', function () {
    // Before §5.2 a super_admin cleared `EnsureUserIsAdmin`, entered the
    // panel, and was then denied by every policy — `Gate::before` tested
    // `hasRole('admin')` exactly. This pins the superset for the media
    // surfaces specifically, since they were built after that fix and
    // would regress silently if someone reverted it.
    $speech = mediaPlayableSpeech();
    SpeechTranscript::factory()->create([
        'speech_id' => $speech->id,
        'body' => 'SUPER-ADMIN-CAN-READ-THIS',
    ]);

    Livewire::actingAs(mediaSuperAdmin())
        ->test(ManageSpeeches::class)
        ->loadTable()
        ->mountAction(TestAction::make('viewTranscript')->table($speech))
        ->assertMountedActionModalSee('SUPER-ADMIN-CAN-READ-THIS');
});
