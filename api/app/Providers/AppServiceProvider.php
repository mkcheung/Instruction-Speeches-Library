<?php

namespace App\Providers;

use App\Models\Connection;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Policies\AccountPolicy;
use App\Policies\AnnotationPolicy;
use App\Policies\ConnectionPolicy;
use App\Policies\ReportPolicy;
use App\Policies\ReviewPolicy;
use App\Policies\SpeechPolicy;
use App\Policies\UserPolicy;
use App\Services\Captions\CaptionTranscriberContract;
use App\Services\Captions\DeterministicCaptionTranscriber;
use App\Services\Captions\FakeCaptionTranscriber;
use App\Services\Captions\WhisperTranscriber;
use App\Services\Essay\EssayRenderer;
use App\Services\Essay\NullEssayRenderer;
use App\Services\Scanning\ClamdScanner;
use App\Services\Scanning\ClamScannerContract;
use App\Services\Scanning\FakeClamScanner;
use App\Services\Transcoding\FakeTranscoder;
use App\Services\Transcoding\FfmpegTranscoder;
use App\Services\Transcoding\TranscoderContract;
use App\Services\Voice\FakeVoiceNoteProcessor;
use App\Services\Voice\FakeVoiceNoteTranscriber;
use App\Services\Voice\FfmpegVoiceNoteProcessor;
use App\Services\Voice\VoiceNoteProcessorContract;
use App\Services\Voice\VoiceNoteTranscriberContract;
use App\Services\Voice\WhisperVoiceNoteTranscriber;
use App\Support\Role;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use RuntimeException;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // §9.4 rule 2's adapter seam: FakeTranscoder in testing/CI so the
        // upload flow is testable without real ffmpeg (STEP-03), the
        // remux-only FfmpegTranscoder everywhere else (dev/prod) until
        // STEP-04 replaces the binding with the full pipeline.
        $this->app->bind(TranscoderContract::class, function () {
            return $this->app->environment('testing')
                ? new FakeTranscoder
                : new FfmpegTranscoder;
        });

        // STEP-08-essay.md's seam: mirrors the TranscoderContract binding
        // shape immediately above, except there is only one implementation
        // today (no real renderer exists yet in any environment — nothing
        // in this step calls EssayRenderer::render() at all).
        $this->app->bind(EssayRenderer::class, NullEssayRenderer::class);

        // STEP-09-captions.md / the frozen STEP-09 backend contract §6:
        // the exact same testing/dev-prod split as TranscoderContract
        // above, for the exact same reason — FakeCaptionTranscriber in
        // testing/CI so the upload/caption flow is testable without a real
        // whisper.cpp binary or GGUF model weights present, WhisperTranscriber
        // everywhere else.
        //
        // STEP-09-VERIFICATION-PLAN.md §3.1/§4.2 point 3 adds a third
        // branch: the `caption-test-worker` compose service sets
        // `CAPTION_TEST_WORKER=1` on itself only, so this doesn't touch
        // `app`/`queue-worker`/`whisper-worker`'s own bindings. Checked
        // here at register() time (process startup), not only lazily
        // inside the closure below, so a misconfigured production
        // container fails immediately on boot instead of waiting for its
        // first queued caption job — an operator mis-copying `e2e`'s env
        // into a real deploy is exactly the mistake this guards against,
        // and it must not silently hand production traffic a fake,
        // blockable transcriber.
        if (config('captions.test_worker_enabled') && ! $this->app->environment('e2e', 'testing')) {
            throw new RuntimeException('CAPTION_TEST_WORKER=1 is only valid under APP_ENV=e2e|testing.');
        }

        $this->app->bind(CaptionTranscriberContract::class, function () {
            if (config('captions.test_worker_enabled')) {
                return new DeterministicCaptionTranscriber;
            }

            return $this->app->environment('testing')
                ? new FakeCaptionTranscriber
                : new WhisperTranscriber;
        });

        $this->app->bind(VoiceNoteProcessorContract::class, fn () => ($this->app->environment('testing') || config('captions.test_worker_enabled'))
            ? $this->app->make(FakeVoiceNoteProcessor::class)
            : $this->app->make(FfmpegVoiceNoteProcessor::class));
        $this->app->bind(VoiceNoteTranscriberContract::class, fn () => ($this->app->environment('testing') || config('captions.test_worker_enabled'))
            ? $this->app->make(FakeVoiceNoteTranscriber::class)
            : $this->app->make(WhisperVoiceNoteTranscriber::class));

        // STEP-12-FROZEN-CONTRACT.md §5: the exact same testing/dev-prod
        // conditional-bind shape as TranscoderContract above —
        // FakeClamScanner in testing/CI (always clean, so the upload/
        // scan-job wiring is testable without a real `clamd` socket),
        // ClamdScanner (talks to the `clamav` compose service) everywhere
        // else.
        $this->app->bind(ClamScannerContract::class, function () {
            return $this->app->environment('testing')
                ? new FakeClamScanner
                : new ClamdScanner;
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // From the first model onward (§21/S1 acceptance) — surfaces N+1s
        // as exceptions in dev/test rather than silent extra queries, and
        // is off in production so a missed eager-load degrades rather than
        // 500s for a real user.
        Model::preventLazyLoading(! $this->app->isProduction());

        // §10.4 "alongside it": STEP-07 adds several new mass-assignment-
        // heavy write endpoints (annotation create/update) where a
        // silently-discarded `lock_version` or `client_uuid` on a malformed
        // payload is exactly the bug class these two catch. Same
        // dev/test-on, production-off shape as preventLazyLoading above.
        Model::preventSilentlyDiscardingAttributes(! $this->app->isProduction());
        Model::preventAccessingMissingAttributes(! $this->app->isProduction());

        // STEP-05: first Policy classes in this codebase. Explicit
        // Gate::policy registration rather than relying purely on Laravel's
        // {Model}Policy naming-convention discovery, so it's obvious from
        // this file alone which model maps to which policy.
        Gate::policy(Speech::class, SpeechPolicy::class);
        Gate::policy(Review::class, ReviewPolicy::class);

        // STEP-12: UserPolicy/AccountPolicy are new classes (nothing
        // existed to extend — see each class's own docblock).
        Gate::policy(User::class, UserPolicy::class);

        // STEP-13-FROZEN-CONTRACT.md §11.
        Gate::policy(Connection::class, ConnectionPolicy::class);

        // Dotted ability names, registered explicitly so the string a
        // controller passes to authorize()/can() is the exact same string
        // Gate::before's $mustFallThrough checks below — the whole point
        // of the dotted `review.*` convention over the bare `{Model}Policy`
        // method-name convention is that "review.accept" reads
        // unambiguously as the coaching ability the fall-through list is
        // guarding, wherever either is referenced.
        Gate::define('review.accept', [ReviewPolicy::class, 'accept']);
        Gate::define('review.decline', [ReviewPolicy::class, 'decline']);
        Gate::define('review.withdraw', [ReviewPolicy::class, 'withdraw']);
        Gate::define('review.abandon', [ReviewPolicy::class, 'abandon']);
        Gate::define('review.revoke', [ReviewPolicy::class, 'revoke']);
        Gate::define('review.purge', [ReviewPolicy::class, 'purge']);
        Gate::define('speech.invite', [SpeechPolicy::class, 'invite']);

        // STEP-06: bare (undotted) ability name, matching the exact
        // literal `Gate::authorize('readAnnotations', [$review])` call the
        // frozen backend/frontend contract specifies. Registered explicitly
        // rather than relying on the Review::class policy binding above —
        // AnnotationPolicy is a distinct class from ReviewPolicy even
        // though both act on a Review argument.
        Gate::define('readAnnotations', [AnnotationPolicy::class, 'readAnnotations']);

        // STEP-07: the authoring surface. `annotation.create/update/delete`
        // and `review.publish` were already reserved in $mustFallThrough
        // below by whoever built S05/S06 — this is where they finally get
        // a Gate::define and a policy method behind them.
        Gate::define('annotation.create', [AnnotationPolicy::class, 'create']);
        Gate::define('voice.create', [AnnotationPolicy::class, 'createVoice']);
        Gate::define('voice.retryTranscript', [AnnotationPolicy::class, 'retryVoiceTranscript']);
        Gate::define('voice.updateTranscript', [AnnotationPolicy::class, 'updateVoiceTranscript']);
        Gate::define('voice.restore', [AnnotationPolicy::class, 'restoreVoice']);
        Gate::define('voice.delete', [AnnotationPolicy::class, 'deleteVoice']);
        Gate::define('annotation.update', [AnnotationPolicy::class, 'update']);
        Gate::define('annotation.delete', [AnnotationPolicy::class, 'delete']);
        Gate::define('review.publish', [ReviewPolicy::class, 'publish']);
        Gate::define('review.clearAnnotations', [ReviewPolicy::class, 'clearAnnotations']);

        // STEP-08-essay.md: the essay-write surface. Reads reuse
        // `readAnnotations` unchanged (see that method's own docblock) —
        // no new Gate for reads, only these two write abilities.
        Gate::define('essay.update', [AnnotationPolicy::class, 'essayUpdate']);
        Gate::define('essay.publish', [AnnotationPolicy::class, 'essayPublish']);

        // STEP-09-captions.md / the frozen STEP-09 backend contract §1-§2:
        // the caption read/write surface. `caption.readCaptions` is
        // registered for the same explicit-naming reason every other
        // dotted ability here is, but per §2 of the contract does NOT go
        // into $mustFallThrough below — widening admin read access isn't
        // the same failure mode as widening admin write access (same
        // reasoning essay reads are exempt for). Only `caption.update`
        // needs the guard.
        Gate::define('caption.readCaptions', [SpeechPolicy::class, 'readCaptions']);
        Gate::define('caption.update', [SpeechPolicy::class, 'updateCaptions']);

        // STEP-12-FROZEN-CONTRACT.md §2/§3/§4: the admin-moderation
        // surface. `role.assign`/`role.revoke` are the GENERIC abilities
        // (distinct from the existing `role.grantSuperAdmin`/
        // `revokeSuperAdmin` pair below) that gate
        // App\Services\RoleAssignmentService's two entry points —
        // `user.delete`/`user.suspend` gate App\Services\
        // UserDeletionService's. `account.eraseSelf` extends STEP-11's
        // self-erasure with the "unless last admin" clause.
        Gate::define('role.assign', [UserPolicy::class, 'assign']);
        Gate::define('role.revoke', [UserPolicy::class, 'revoke']);
        Gate::define('user.delete', [UserPolicy::class, 'delete']);
        Gate::define('user.suspend', [UserPolicy::class, 'suspend']);
        Gate::define('account.eraseSelf', [AccountPolicy::class, 'eraseSelf']);

        // PLAN-APP-HEADER.md S4: wires up ReviewPolicy::viewDirectory, which
        // existed as dead code (P2) — ReviewerDirectoryController made no
        // authorization call at all. Registered explicitly, same as every
        // other dotted ability above.
        Gate::define('viewDirectory', [ReviewPolicy::class, 'viewDirectory']);

        // STEP-13-FROZEN-CONTRACT.md §11: `request`/`accept`/`decline`/
        // `unblock` are self-scoped like `account.eraseSelf` (no ownership
        // ambiguity — the service resolves "my own row" server-side) and
        // deliberately get no Gate ability. `block` is the one ability that
        // needs one, and per §11 it MUST be added to $mustFallThrough below
        // in this same commit.
        Gate::define('connection.block', [ConnectionPolicy::class, 'block']);

        // PLAN-ADMIN-DASHBOARD.md §5.3: the four PHANTOM abilities. All
        // four strings have sat in $mustFallThrough below since STEP-12
        // with no Gate::define anywhere — an ability that is both
        // unregistered AND excluded from the admin bypass denies
        // everyone, so this was safe but inert, and §5.3's actual
        // complaint is the consequence: "there is no path to grant
        // `super_admin` at all." Per §4 all four are super_admin-ONLY
        // (see UserPolicy's own docblocks) — the only abilities in this
        // provider where the two administrative tiers diverge, now that
        // §5.2 has collapsed every other site onto Role::ADMIN_TIER.
        //
        // They STAY in $mustFallThrough after this change, and that is
        // the load-bearing half: a plain admin must keep getting `false`
        // here, and Gate::before's blanket bypass would hand them `true`
        // before these policy methods ever ran.
        Gate::define('user.erase', [UserPolicy::class, 'erase']);
        Gate::define('user.demote', [UserPolicy::class, 'demote']);
        Gate::define('role.grantSuperAdmin', [UserPolicy::class, 'grantSuperAdmin']);
        Gate::define('role.revokeSuperAdmin', [UserPolicy::class, 'revokeSuperAdmin']);

        // §5.4: three abilities that did not exist in any form. The
        // takedown hole is the one §5.4 ranks worst — "the only
        // destructive verb on content, gated solely by
        // `EnsureUserIsAdmin`" (SpeechResource.php:90-107), with no
        // Gate::authorize and no ability string to authorize against —
        // and report resolve/dismiss had neither Gate nor audit
        // (ReportResource.php:47-69). All three are admin-tier per §4,
        // so they answer `true` for an admin either way TODAY; what
        // $mustFallThrough buys is that the answer comes from a policy
        // method instead of the bypass, which is what lets §5.5's
        // mandatory reason and §5.6's byte purge actually bind.
        //
        // `report.resolve` covers dismissal too — one capability, two
        // outcomes, distinguished by AuditAction::REPORT_RESOLVED vs
        // REPORT_DISMISSED rather than by two abilities (see
        // ReportPolicy's docblock).
        Gate::define('speech.takedown', [SpeechPolicy::class, 'takedown']);
        Gate::define('speech.restore', [SpeechPolicy::class, 'restore']);
        Gate::define('report.resolve', [ReportPolicy::class, 'resolve']);

        // Admin's override is a SCOPED Gate::before, not a blanket one
        // (§7.2) — a blanket hook would bypass the very policies Admin must
        // NOT have, e.g. reviewing. Written now, before any concrete
        // policies exist, so later steps extend $mustFallThrough instead of
        // having to remember to retrofit this hook (revision 2's mistake,
        // per the plan: it omitted `user.delete` and let a destructive
        // admin action skip its safeguards entirely).
        // PLAN-ADMIN-DASHBOARD.md §5.2 / §1.2: this hook's role test was
        // `hasRole('admin')` EXACTLY, while EnsureUserIsAdmin.php:39
        // admitted hasAnyRole(['admin','super_admin']). Spatie applies no
        // hierarchy and the roles never stack (GrantRoleCommand and
        // E2ESeeder both syncRoles), so super_admin was a strict SUBSET
        // of admin, not a superset: §1.2's "a super_admin-only account
        // logs in, sees every table, and every moderation button fails
        // with a red toast." This line is the most important of the 15
        // sites §5.2 corrects — it is the one that governs every ability
        // NOT in the list below.
        //
        // Break-glass (§5.8): a Gate::before change that goes wrong locks
        // the only operator out of their own panel. Recovery is
        // `php artisan user:grant-role` from the CLI, which calls
        // syncRoles() directly and bypasses both this hook and
        // RoleAssignmentService.
        Gate::before(function (User $user, string $ability) {
            if (! $user->hasAnyRole(Role::ADMIN_TIER)) {
                return null;
            }

            static $mustFallThrough = [
                'review.accept', 'review.decline', 'review.publish',   // coaching is an act
                'review.withdraw', 'review.abandon',                   // ditto — reviewer-only acts
                'speech.invite',                                       // ownership, not an admin power
                'annotation.create', 'voice.create', 'voice.retryTranscript', 'voice.updateTranscript', 'voice.restore', 'voice.delete', 'annotation.update', 'annotation.delete',
                'review.clearAnnotations',                             // STEP-07: never an admin power either
                'readAnnotations',                                     // AnnotationPolicy's own admin branch runs the dual-role assert

                // STEP-08: the essay-write surface — same bug class the
                // 2026-08-16 readiness review flagged. Without these two
                // here, Gate::before's blanket admin bypass above would
                // silently grant admins essay-write, contradicting the
                // plan's explicit "An Admin cannot... write an essay"
                // acceptance criterion (MODERNIZATION_PLAN.md:2384).
                'essay.update', 'essay.publish',

                // STEP-09: ownership-only, same bug class as essay.update/
                // publish immediately above — without this here, the
                // blanket admin bypass would silently grant admins
                // caption-write, contradicting SpeechPolicy::updateCaptions'
                // "owner ('the speaker') only" contract.
                'caption.update',

                'user.delete', 'user.erase', 'user.demote',            // destructive identity ops
                'role.grantSuperAdmin', 'role.revokeSuperAdmin',

                // PLAN-ADMIN-DASHBOARD.md §5.7's STANDING RULE, applied
                // to the three abilities §5.4 adds: "Gate::before state 3
                // is allow-by-default for admins on any unregistered
                // ability string (AuthorizationScaffoldTest.php:24
                // asserts allows('some.arbitrary.ability') === true).
                // Every new ability must be added to $mustFallThrough in
                // the same commit, or it is an unconditional admin yes."
                //
                // These three are admin-tier in §4's matrix, so unlike
                // every other entry in this list they are NOT here to
                // DENY an admin — their policies grant admin-tier. They
                // are here so the GRANT is the policy's to make. Leaving
                // them out would produce the same `true` today and then
                // silently ignore §5.5's mandatory takedown reason and
                // §5.6's byte purge the moment either is added to
                // SpeechPolicy, because an admin would never reach it.
                //
                // That makes this block the easiest one in the file to
                // "clean up" by mistake. It is not dead weight.
                'speech.takedown', 'speech.restore', 'report.resolve',

                // STEP-12-FROZEN-CONTRACT.md §2: confirmed missing prior
                // to this step, added in the SAME commit as
                // RoleAssignmentService/UserDeletionService and the
                // Gate::define calls above — the single highest-risk item
                // in this step per both readiness review agents. Without
                // these here, Gate::before's blanket admin bypass would
                // let ANY admin assign/revoke ANY role (including
                // super_admin) or suspend ANY user (including another
                // admin, or themselves) with zero policy check at all —
                // the exact bug class the plan's own history names (rev 2
                // omitted `user.delete`).
                'role.assign', 'role.revoke', 'user.suspend',

                // S4: §7.1's matrix denies Admin the reviewer directory —
                // without this, Gate::before's blanket admin bypass would
                // short-circuit ReviewPolicy::viewDirectory to `true` and
                // invert the intended admin-403/member-200 behaviour.
                'viewDirectory',

                // STEP-13-FROZEN-CONTRACT.md §11: an Admin never becomes a
                // party to a connection, same categorical reasoning as
                // 'speech.invite' and 'review.*' above — without this here,
                // Gate::before's blanket admin bypass would let ANY admin
                // block ANY pair of users through ConnectionPolicy::block,
                // contradicting that method's own admin-denial branch.
                'connection.block',
            ];

            return in_array($ability, $mustFallThrough, true) ? null : true;
        });

        // STEP-13-FROZEN-CONTRACT.md §8 (R17): per-pair invite rate limit,
        // matching FortifyServiceProvider's RateLimiter::for('login', ...)
        // convention — the only existing precedent for a named limiter in
        // this codebase. Keyed on (requester, target) so it's per-PAIR, not
        // per-requester globally: 5 connection requests to the SAME target
        // per 24h, not 5 requests total. Deliberately does NOT gate
        // ReviewService::invite — see that class and §8 of the frozen
        // contract, a deliberate scope decision, not an oversight.
        RateLimiter::for('connection-request', function (Request $request) {
            $targetId = $request->input('user_id');

            return Limit::perDay(5)->by($request->user()?->id.'|'.$targetId);
        });

        // STEP-14-deploy-hardening.md ("Upload rate limiting"), R10: on a
        // free-tier fixed disk volume, uncontrolled uploads are the single
        // most likely production outage per the plan's own risk register
        // (MODERNIZATION_PLAN.md R10) — same reasoning as connection-request
        // above (R17's unsolicited-invite spam), applied to disk/storage
        // instead of inbox noise. Same `Limit::perX(...)->by(...)` idiom,
        // keyed on user id (falling back to IP for the rare unauthenticated
        // case) rather than the (requester, target) pair above, since there
        // is no "target" for an upload. One limiter per upload-shaped
        // surface, each picked generous enough that ordinary single-speech
        // usage never sees a 429:
        //
        // - video-upload: each call opens a NEW S3 multipart upload and a
        //   NEW SpeechAsset row. QuotaService::reserve already caps
        //   aggregate bytes, but says nothing about upload COUNT — a
        //   speaker rarely starts more than a handful of speeches an hour.
        // - avatar-upload: a profile photo changes rarely.
        // - voice-note-upload: the one surface genuinely used many times in
        //   a single sitting (a reviewer can leave dozens of notes across
        //   one speech), so this is the most generous of the four.
        // - coach-document-upload: STEP-12-FROZEN-CONTRACT.md §9 caps an
        //   application at two documents total in the ordinary flow.
        RateLimiter::for('video-upload', function (Request $request) {
            return Limit::perHour(10)->by($request->user()?->id ?: $request->ip());
        });

        RateLimiter::for('avatar-upload', function (Request $request) {
            return Limit::perHour(10)->by($request->user()?->id ?: $request->ip());
        });

        RateLimiter::for('voice-note-upload', function (Request $request) {
            return Limit::perHour(60)->by($request->user()?->id ?: $request->ip());
        });

        RateLimiter::for('coach-document-upload', function (Request $request) {
            return Limit::perHour(10)->by($request->user()?->id ?: $request->ip());
        });
    }
}
