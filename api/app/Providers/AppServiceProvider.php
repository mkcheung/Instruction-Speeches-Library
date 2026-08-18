<?php

namespace App\Providers;

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Policies\AnnotationPolicy;
use App\Policies\ReviewPolicy;
use App\Policies\SpeechPolicy;
use App\Services\Captions\CaptionTranscriberContract;
use App\Services\Captions\DeterministicCaptionTranscriber;
use App\Services\Captions\FakeCaptionTranscriber;
use App\Services\Captions\WhisperTranscriber;
use App\Services\Essay\EssayRenderer;
use App\Services\Essay\NullEssayRenderer;
use App\Services\Transcoding\FakeTranscoder;
use App\Services\Transcoding\FfmpegTranscoder;
use App\Services\Transcoding\TranscoderContract;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;
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

        // PLAN-APP-HEADER.md S4: wires up ReviewPolicy::viewDirectory, which
        // existed as dead code (P2) — ReviewerDirectoryController made no
        // authorization call at all. Registered explicitly, same as every
        // other dotted ability above.
        Gate::define('viewDirectory', [ReviewPolicy::class, 'viewDirectory']);

        // Admin's override is a SCOPED Gate::before, not a blanket one
        // (§7.2) — a blanket hook would bypass the very policies Admin must
        // NOT have, e.g. reviewing. Written now, before any concrete
        // policies exist, so later steps extend $mustFallThrough instead of
        // having to remember to retrofit this hook (revision 2's mistake,
        // per the plan: it omitted `user.delete` and let a destructive
        // admin action skip its safeguards entirely).
        Gate::before(function (User $user, string $ability) {
            if (! $user->hasRole('admin')) {
                return null;
            }

            static $mustFallThrough = [
                'review.accept', 'review.decline', 'review.publish',   // coaching is an act
                'review.withdraw', 'review.abandon',                   // ditto — reviewer-only acts
                'speech.invite',                                       // ownership, not an admin power
                'annotation.create', 'annotation.update', 'annotation.delete',
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

                // S4: §7.1's matrix denies Admin the reviewer directory —
                // without this, Gate::before's blanket admin bypass would
                // short-circuit ReviewPolicy::viewDirectory to `true` and
                // invert the intended admin-403/member-200 behaviour.
                'viewDirectory',
            ];

            return in_array($ability, $mustFallThrough, true) ? null : true;
        });
    }
}
