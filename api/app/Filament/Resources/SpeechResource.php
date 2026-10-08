<?php

namespace App\Filament\Resources;

use App\Filament\Resources\SpeechResource\Pages\ManageSpeeches;
use App\Jobs\PurgeSpeechMedia;
use App\Models\Annotation;
use App\Models\AuditLog;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Notifications\SpeechTakenDown;
use App\Services\EssayService;
use App\Services\MediaUrlSigner;
use App\Support\AuditAction;
use App\Support\Role;
use Filament\Actions\Action;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\PageRegistration;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Support\Enums\Width;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;

/**
 * STEP-12-admin-portal.md demo steps 8-10: "open any speech, see every
 * annotation grouped by reviewer — the join the legacy schema's missing
 * author column made unwritable"; "take down a speech."
 *
 * Every row view and every takedown writes to `audit_log` here in the
 * controller/action layer (never inside a Policy, per §14's own rule) —
 * see `viewAnnotations`/`takedown` below.
 *
 * PLAN-ADMIN-DASHBOARD.md §5.4 closed THREE of its eight authorization
 * holes in this one file, which is why so much of the commentary below is
 * about what used to be here:
 *
 *  1. `takedown` had no `Gate::authorize` at all and no `speech.takedown`
 *     ability existed anywhere — "the only destructive verb on content,
 *     gated solely by `EnsureUserIsAdmin`."
 *  2. The annotations modal bypassed the read policy entirely: a raw
 *     `Annotation::query()->where('review_id', ...)` with no Gate, no
 *     `scopeVisibleTo`, and no owner exclusion.
 *  3. The ADMIN_VIEWED_COMMENTARY audit fired on `->action()` (modal
 *     SUBMIT), so an admin who opened the modal, read everything and
 *     closed it left no audit row.
 *
 * §5.5 then added the mandatory moderation reason + speaker notification,
 * and §6.3's `restore` makes takedown reversible from the panel — rows
 * showed `deleted_at` with no way back.
 *
 * ---------------------------------------------------------------------
 * PLAN-ADMIN-DASHBOARD.md §6.3 (Phase 2b) — "watch, hear, read, restore"
 * ---------------------------------------------------------------------
 *
 * §2's baseline table lists four things this panel could not do: **watch
 * video**, read transcript, **hear voice notes**, **read essays**. All
 * four now have a surface here, in ascending order of how much authority
 * each one hands out:
 *
 *  1. `viewTranscript` — a plain `speech_transcripts` row. No storage
 *     round trip, no signed URL, nothing transferable. Readable for a
 *     TRASHED speech on purpose: the API 410s on one, which is precisely
 *     the moment a moderator needs the text.
 *  2. `viewAnnotations` — now also presigns `kind='voice_note'` audio and
 *     renders the review's essay. These are v1, not nice-to-have:
 *     `Report::REPORTABLE_TYPES` admits a **Review**, so a moderator can
 *     receive a report about a coach's voice commentary, and before this
 *     the modal rendered `{{ $annotation->body }}` — NULL for a voice
 *     note — and never showed `Review.essay_html`/`essay_text` at all.
 *  3. `viewVideo` — a presigned bucket URL for the primary rendition.
 *
 * ⚠️⚠️ PRESIGNING IS A PRAGMATIC CHOICE, NOT SAFE-BY-ARCHITECTURE. ⚠️⚠️
 *
 * An earlier revision of the plan justified this surface with "the media
 * host has no admin session cookie scoped to it — origin separation is
 * already structural." §6.3 corrects that in bold, and the correction is
 * the reason this comment block is as long as it is. The real position:
 *
 *  - `.env.example:98` sets `SESSION_DOMAIN=.speechcoach.test` with a
 *    LEADING DOT, so the session cookie IS sent to
 *    `media.speechcoach.test`, and `config/session.php:202` is
 *    `same_site: lax`, so media→api requests are same-site and carry
 *    credentials. In dev the media host is `localhost:8333`, which shares
 *    a cookie domain outright (cookies ignore ports). There is no origin
 *    separation to lean on.
 *  - Every URL minted below is a **transferable bearer token**. Anyone
 *    holding the string can fetch the bytes for its whole TTL, from any
 *    client, with no session and no role. `MediaUrlSigner::presign()` is
 *    a pure `(path, ttl) -> URL` function that enforces NO authorization
 *    whatsoever — every access decision lives at the call site, which is
 *    why both call sites below check before they sign and never after.
 *  - The `ADMIN_VIEWED_SPEECH` rows written below therefore record **"a
 *    URL was minted"**, not "this admin watched this speech." That is a
 *    real downgrade in accountability versus the coach-application PDF
 *    proxy (which authorizes every single byte-serving request through
 *    `ApplicationDocumentDownloadController`), and it is a downgrade on a
 *    surface whose entire justification *is* accountability. It is
 *    accepted because §3 rules `X-Accel-Redirect` per-request media
 *    authorization out of scope entirely, so the alternative is not a
 *    better mechanism — it is no surface at all, which is the status quo
 *    §2 describes as a moderator who cannot see what was reported.
 *  - It leaks further than browser history: the Livewire component
 *    payload (re-sent on every round trip), the rendered DOM, nginx
 *    access logs on the media vhost, and potentially GlitchTip
 *    breadcrumbs (STEP-14 wired Sentry).
 *  - **It keeps working after a takedown.** The state gates below refuse
 *    to MINT a URL for a trashed speech, and that is all they can do:
 *    §1.3 proves rotation is architecturally unavailable — the object
 *    path is `speeches/{ulid}/{ulid}/720p.mp4`, deterministic from the
 *    ULID alone, because the intended `{playback_key}` path was never
 *    built (`playback_key` has one write site in `app/` and **zero
 *    reads**). A URL minted one minute before a takedown stays live for
 *    the rest of its TTL and nothing in this codebase can revoke it.
 *  - "A video cannot execute script" is not format-universal. The
 *    `kind='video'` CHECK admits `format IN ('mp4','hls')`, and an HLS
 *    manifest is a text playlist of arbitrary URIs that needs a JS
 *    player. True for today's mp4; false for the schema's permitted set.
 *    Compounding it, `CreateUploadRequest.php:27` validates
 *    `content_type` as `['required','string','max:255']` with **no mime
 *    allowlist** and `MultipartUploadService.php:56` passes it straight
 *    through, so a user can park an object the media host serves as
 *    `text/html`. The `kind='video' AND is_primary AND status='ready'`
 *    gate excludes that today — but the case where an admin most wants
 *    to look (a failed transcode) is exactly the one where only the
 *    `source` asset exists, which is why this resource deliberately
 *    offers NO surface for a non-`ready` asset rather than a
 *    "view source" escape hatch.
 *
 * Two mechanical constraints that look like oversights and are not:
 *
 *  - **1-hour TTL, not `MediaUrlSigner::DEFAULT_TTL_SECONDS` (600).**
 *    §9.3's 10-minute default is safe for the SPA because
 *    `videojs-adapter.ts:98-131` re-presigns on the playback error, and
 *    `SpeechUploadController::playbackUrl` exists to serve that refresh.
 *    A Blade modal has no equivalent on either side, so at 600s a speech
 *    longer than the TTL simply breaks on seek with no recovery. The
 *    1-hour precedent is `app/Http/Resources/SpeechResource.php:124`
 *    (the **HTTP** resource — same basename as this class, different
 *    class, and §6.3 flags that collision explicitly) which presigns
 *    posters at 3600 for the same "no refresh mechanism behind this
 *    element" reason. Longer TTL = longer-lived bearer token; that is
 *    the trade, stated rather than hidden.
 *  - **No `crossorigin`, no `<track>`.** `media:configure-cors` builds
 *    `AllowedOrigins` from `config('cors.allowed_origins')`, which is the
 *    SPA origin only, and this panel is on `api.`. Anything CORS-y fails
 *    silently here. A plain `<video src>`/`<audio src>` works, so the
 *    blades use exactly that and no more.
 */
class SpeechResource extends Resource
{
    protected static ?string $model = Speech::class;

    /**
     * PLAN-ADMIN-DASHBOARD.md §7. Five flat, icon-less, arbitrarily
     * ordered nav items was the shipped state — no resource set a group,
     * an icon or a sort. Grouping matters more than it looks: the panel's
     * landing page is now a dashboard (§6.1), so the sidebar is the only
     * wayfinding an admin has, and "Moderation" (what needs attention
     * today) versus "People" (who the platform is made of) is the split
     * an actual moderation session follows.
     */
    protected static \UnitEnum|string|null $navigationGroup = 'Moderation';

    protected static \BackedEnum|string|null $navigationIcon = 'heroicon-o-film';

    protected static ?int $navigationSort = 2;

    protected static ?string $navigationLabel = 'Speeches';

    /**
     * §6.3's cost 6, as a number. See the class docblock for the full
     * reasoning: a Blade modal has no counterpart to the SPA's
     * error-driven re-presign, so the default 600s breaks any speech
     * longer than its own TTL on the first seek past expiry. Applied to
     * voice-note audio as well as video — a moderator working through a
     * reviewer's whole annotation list keeps that modal open for many
     * minutes, and the modal has no refresh handler for audio either.
     */
    private const PANEL_MEDIA_TTL_SECONDS = 3600;

    public static function form(Schema $schema): Schema
    {
        return $schema->components([]);
    }

    /**
     * The signed-link lifetime in minutes, for the badge
     * `speech-video.blade.php` shows next to the player. A moderator who
     * leaves a modal open and comes back to a dead URL should be able to
     * tell that it EXPIRED rather than that playback is broken — the
     * presigned link cannot be refreshed in place (there is no Blade
     * equivalent of the SPA's error-driven re-presign), so the only
     * recovery is reopening the modal, and the badge is what makes that
     * obvious.
     */
    public static function panelMediaTtlMinutes(): int
    {
        return intdiv(self::PANEL_MEDIA_TTL_SECONDS, 60);
    }

    /**
     * The actor behind any §6.3 READ surface, refused in the closure
     * rather than trusted from the route.
     *
     * Two guards, and they answer different questions:
     *
     *  - `$actor === null` is the same "auth guaranteed non-null" note
     *    every other closure in this panel carries: `EnsureUserIsAdmin`
     *    runs before any `/control-panel` route is reachable at all.
     *  - `hasAnyRole(Role::ADMIN_TIER)` is the one that matters here, and
     *    there is deliberately **no `Gate::authorize`** beside it. §5.7's
     *    standing rule is why: `Gate::before` state 3 is allow-by-default
     *    for admins on any UNREGISTERED ability string
     *    (`AuthorizationScaffoldTest.php:24` asserts
     *    `allows('some.arbitrary.ability') === true`), so inventing a
     *    `speech.viewMedia` here without the matching `Gate::define` plus
     *    `$mustFallThrough` entry in `AppServiceProvider` would be a Gate
     *    call that authorizes nothing — the exact trap
     *    `PanelModerationTest.php:609-614` documents for
     *    `report.dismiss`. An honest `hasAnyRole` check is strictly
     *    better than a decorative `Gate::authorize`.
     *
     *    The closest registered read ability, `caption.readCaptions`, is
     *    NOT reused for the same reason it cannot be: it is deliberately
     *    excluded from `$mustFallThrough` (`AppServiceProvider.php:193-200`,
     *    rationale "widening admin *read* is not the same failure mode as
     *    widening admin *write*"), so for an admin it resolves through
     *    `Gate::before`'s blanket bypass and never reaches
     *    `SpeechPolicy::readCaptions` at all — but for a NON-admin it
     *    answers `true` for the speech's own owner and for any active
     *    reviewer. Using it as the gate here would let a member who owns
     *    the speech mint a panel URL and, worse, stamp an
     *    `ADMIN_VIEWED_SPEECH` row with a non-admin actor, poisoning the
     *    one trail this surface exists to produce. The tier check is the
     *    real predicate; `Role::ADMIN_TIER` is §5.2's single statement of
     *    it, so super_admin passes here exactly as admin does.
     *
     * `abort()`, not a caught `AuthorizationException` + Notification:
     * every write action in this file catches, because a denied write
     * should leave the admin on the page with a red toast. These are
     * `modalContent()` closures — there is no form to return to and
     * nothing partial to render, so refusing the request outright is the
     * correct shape, and it is what makes "no audit row, no signed URL"
     * assertable in a test.
     */
    private static function adminActor(): User
    {
        $actor = auth()->user();
        abort_if($actor === null, 403);
        abort_unless($actor->hasAnyRole(Role::ADMIN_TIER), 403);

        return $actor;
    }

    /**
     * §6.3 surface 2 — "voice notes and essays are v1, not optional".
     *
     * The reason they are v1: `Report::REPORTABLE_TYPES` lets a user
     * report a **Review**, so a moderator can receive a report about a
     * coach's commentary and — before this — had no way to hear or read
     * the thing being reported. The annotations modal rendered
     * `{{ $annotation->body }}`, which is NULL for a voice note, and never
     * surfaced `Review.essay_html`/`essay_text` at all. A report queue
     * pointing at content the queue cannot display is not a moderation
     * tool.
     *
     * Three separate visibility rules apply here and they are NOT the
     * same rule:
     *
     *  1. **Annotations** go through `Annotation::scopeVisibleTo($actor,
     *     $review)`, which carries the `speech_owner_id !== $user->id`
     *     exclusion — an admin who is ALSO the speaker on this speech sees
     *     published rows only, never their own coach's drafts (§5.4 hole
     *     6). The scope decides; this method never re-implements it.
     *  2. **Voice notes** are presigned only for annotations that survived
     *     that same scope, so a draft voice note belonging to the
     *     admin-as-speaker's own coach is never minted a URL. Each URL is
     *     a bearer token — see the class docblock.
     *  3. **Essays** are disclosed only once PUBLISHED
     *     (`essay_published_at`). An unpublished essay is a coach's
     *     working draft in exactly the sense §5.4 hole 6 protects, and
     *     `EssayService::sanitizedHtmlForRead()` is used rather than the
     *     raw column because §6.6's read-time sanitization pass exists
     *     precisely so a stored-XSS bypass cannot be served to the
     *     highest-privilege origin in the system.
     *
     * `audio` is KEYED BY ANNOTATION ID, which is what the blade's own
     * comment already claimed it was. It was a list of rows each carrying
     * an `annotation_id`, so the view had to
     * `collect($group['audio'])->firstWhere('annotation_id', $id)` once
     * per annotation — a fresh Collection and a linear scan per row,
     * O(annotations × voice notes) inside a modal §6.3 widened precisely
     * because a reviewer group can hold many notes. Keying it makes the
     * lookup `$group['audio'][$annotation->id] ?? null` and makes the
     * "a missing entry is a DELIBERATE refusal" contract the blade
     * documents directly readable.
     *
     * @return Collection<int|string, array{reviewer: ?User, annotations: Collection<int, Annotation>, audio: array<array{url: string, annotation_id: int, transcript: string}>, essays: Collection<int, array{review_id: int, text: ?string, html: string, published_at: ?Carbon}>}>
     */
    private static function commentaryGroups(
        Speech $record,
        User $actor,
        MediaUrlSigner $signer,
        EssayService $essays,
    ): Collection {
        return $record->reviews()
            ->with('reviewer')
            ->get()
            ->groupBy('reviewer_id')
            ->map(function (Collection $reviews) use ($actor, $signer, $essays): array {
                /** @var Collection<int, Review> $reviews */
                $visible = $reviews->flatMap(
                    // `groupBy()` never yields an empty group, but
                    // `first()` is unconditionally nullable, so the
                    // reviewer read below stays null-safe rather than
                    // assumed-safe — the same care the pre-existing
                    // version of this closure took.
                    fn (Review $review) => Annotation::query()
                        ->visibleTo($actor, $review)
                        ->where('review_id', $review->id)
                        ->with('audioAsset')
                        ->get()
                );

                $audio = $visible
                    ->filter(function (Annotation $annotation): bool {
                        $asset = $annotation->audioAsset;

                        // §9.4 rule 3 again: `status` is the ONLY
                        // playback-readiness signal. A voice note still
                        // normalizing has a `path` already.
                        return $asset !== null && $asset->status === 'ready';
                    })
                    ->map(function (Annotation $annotation) use ($signer): array {
                        /** @var SpeechAsset $asset */
                        $asset = $annotation->audioAsset;

                        return [
                            'url' => $signer->presign($asset->path, self::PANEL_MEDIA_TTL_SECONDS),
                            'annotation_id' => $annotation->id,
                            'transcript' => $annotation->body,
                        ];
                    })
                    ->keyBy('annotation_id')
                    ->all();

                $essayRows = $reviews
                    ->filter(fn (Review $review) => $review->essay_published_at !== null)
                    ->map(fn (Review $review) => [
                        'review_id' => $review->id,
                        'text' => $review->essay_text,
                        'html' => $essays->sanitizedHtmlForRead($review),
                        'published_at' => $review->essay_published_at,
                    ])
                    ->values();

                return [
                    'reviewer' => $reviews->first()?->reviewer,
                    'annotations' => $visible,
                    'audio' => $audio,
                    'essays' => $essayRows,
                ];
            });
    }

    /**
     * Test seam for the gate above, and deliberately nothing more.
     *
     * `playableVideo()` is the generation-time refusal — the layer that
     * still holds when `visible()` is bypassed, which it can be:
     * `InteractsWithActions::mountAction()` checks `isDisabled()` and
     * never `isVisible()`. A test that only drove the UI would assert the
     * button is hidden and prove nothing about the guard that matters, so
     * the predicate itself has to be reachable from a test.
     */
    public static function playableVideoForTesting(Speech $speech): ?SpeechAsset
    {
        return self::playableVideo($speech);
    }

    /**
     * §6.3's state gate for video, as one predicate so the `visible()`
     * affordance and the generation-time refusal cannot drift apart:
     * `kind='video' AND is_primary AND status='ready'` **AND
     * `! trashed()`**.
     *
     * ⚠️ The `! $speech->trashed()` clause is not redundant with
     * `visible()`, and this is the single most important line in this
     * file's §6.3 work. `Filament\Actions\Concerns\InteractsWithActions::
     * mountAction()` (vendor, lines 138-162) checks `isDisabled()` and
     * **never** `isVisible()`, and neither does `resolveActions()` — so a
     * hidden record action is still mountable by a crafted Livewire
     * request. `visible()` removes the button; it does not refuse the
     * call. Since this table deliberately loads trashed rows
     * (`withTrashed()`, so takedowns are reviewable at all), a gate that
     * lived only in `visible()` would hand out a presigned URL for
     * taken-down content — content §1.3 proves is still fully retrievable
     * from the bucket and whose URL cannot afterwards be revoked.
     *
     * `status='ready'` is §9.4 rule 3 ("`speech_assets.status` is the
     * only playback-readiness signal — never inferred from `path`
     * existing, since a queued-but-not-yet-processed row already has
     * one"), so a `processing` row's path is never signed.
     *
     * One query per rendered row, because `visible()` is per-record. Left
     * un-eager-loaded on purpose: §10 defers the index migration with
     * "speeches 4 … tables you can `SELECT *` in a millisecond", and
     * adding `assets` to this table's `with()` would eagerly pull every
     * poster, sprite, caption and voice-note row for every speech to save
     * four indexed lookups.
     */
    private static function playableVideo(Speech $speech): ?SpeechAsset
    {
        if ($speech->trashed()) {
            return null;
        }

        return $speech->assets()
            ->where('kind', 'video')
            ->where('is_primary', true)
            ->where('status', 'ready')
            ->first();
    }

    public static function table(Table $table): Table
    {
        return $table
        // PLAN-ADMIN-DASHBOARD.md §7. Filament tables already scroll
        // horizontally when they overflow, but `filament/tables`'
        // own layout doc is explicit that this is NOT sufficient: "on
        // mobile, the user is unable to see much information in a table
        // row at once without scrolling". `stackedOnMobile()` turns each
        // row into a labelled card below the `sm` breakpoint and adds a
        // sort dropdown, which is the difference between a moderator
        // being able to triage on a phone and not.
        //
        // Applied to all five resources identically rather than per
        // table, because the one thing worse than an unreadable mobile
        // table is four readable ones and a fifth nobody noticed.
            ->stackedOnMobile()
            ->modifyQueryUsing(fn ($query) => $query->withTrashed()->with(['user', 'reviews.reviewer']))
            ->columns([
                // §6.3's "Also add: … title search". §2's baseline table
                // lists `search` among the things the speeches surface
                // could not do; a moderator working from a report has the
                // title and nothing else to find the row by.
                TextColumn::make('title')->searchable(),
                TextColumn::make('user.username')->label('Speaker'),
                TextColumn::make('deleted_at')->label('Taken down')->dateTime(),
                TextColumn::make('reviews_count')->counts('reviews')->label('Reviews'),
            ])
            // §6.3's "state filter". There is no `status` column on
            // `speeches` — the only state this table has is soft-delete,
            // so the filter is over `deleted_at` directly. A ternary
            // rather than a `SelectFilter`, because "all / taken down /
            // live" is exactly three states and the blank case must leave
            // `withTrashed()` untouched: a filter that quietly re-applied
            // the SoftDeletes scope would hide the takedowns this table
            // exists to show.
            ->filters([
                TernaryFilter::make('taken_down')
                    ->label('Takedown state')
                    ->placeholder('All speeches')
                    ->trueLabel('Taken down only')
                    ->falseLabel('Live only')
                    ->queries(
                        true: fn (Builder $query) => $query->whereNotNull('deleted_at'),
                        false: fn (Builder $query) => $query->whereNull('deleted_at'),
                        blank: fn (Builder $query) => $query,
                    ),
            ])
            ->recordActions([
                // §6.3, first surface: "Transcript first." The cheapest
                // and safest of the three — `speech_transcripts` is a
                // plain DB row (`body`, `segments`, `word_count`,
                // `language`, `model`), so there is no storage round trip,
                // no signed URL, and nothing transferable to leak. §2's
                // baseline lists "read transcript" among the things this
                // panel could not do.
                //
                // Authorization: none beyond `adminActor()`'s tier check,
                // and §6.3 is explicit that this is already true today.
                // `caption.readCaptions` is deliberately excluded from
                // `$mustFallThrough` (`AppServiceProvider.php:193-200`,
                // pinned by `SpeechPolicyCaptionsTest.php:123`), so an
                // `admin` could already read any transcript through the
                // API before this action existed. §6.3's own correction:
                // rev 1's "no new authz at all" was true for ONE of the
                // two roles — a `super_admin` could not, because
                // `Gate::before` tested `hasRole('admin')` exactly. §5.2
                // collapsed that onto `Role::ADMIN_TIER`, which is what
                // makes this surface identical for both tiers.
                //
                // NOT hidden when there is no transcript row. A moderator
                // has to be able to tell "captions were never generated
                // for this speech" apart from "this panel has no such
                // button", and the audit row for the attempted read is
                // worth having either way — the blade renders an empty
                // state instead.
                Action::make('viewTranscript')
                    ->label('Read transcript')
                    ->modalSubmitAction(false)
                    ->modalContent(function (Speech $record) {
                        $actor = self::adminActor();

                        // ⚠️ Queried through the relation with NO
                        // `withTrashed()` of its own, and that is correct
                        // rather than an oversight: `SpeechTranscript`
                        // does not use `SoftDeletes`, so it has no
                        // global scope to escape. The `withTrashed()`
                        // that matters is this TABLE's
                        // (`modifyQueryUsing` above) — it is what makes
                        // `$record` resolvable for a taken-down speech in
                        // the first place, and §6.3 wants exactly that:
                        // "the API 410s on a trashed speech, exactly when
                        // a moderator most needs it." A takedown is a
                        // soft delete, so per §1.3 the row is still
                        // right there.
                        $transcript = $record->transcript()->first();

                        // §6.3 / STEP-12-FROZEN-CONTRACT.md §14: "admin
                        // viewing a private speech" was on the audit
                        // trigger list from the start, and
                        // `AuditAction::ADMIN_VIEWED_SPEECH` has existed
                        // since STEP-12 with **no call site anywhere** —
                        // a constant naming a read nothing recorded. This
                        // is that call site.
                        //
                        // Written from `modalContent()` (modal OPEN), NOT
                        // `->action()` (modal SUBMIT). That distinction
                        // is this codebase's most-repeated bug: §5.4's
                        // hole 7 here, and the same mistake again in
                        // `CoachApplicationResource::viewDocuments`. An
                        // audit row that fires on submit records nothing
                        // about the admin who opened a modal, read it and
                        // clicked away — which is every read.
                        //
                        // `trashed` goes in the metadata because reading
                        // a taken-down speech's transcript is the single
                        // most sensitive variant of this read and the
                        // trail should distinguish it without a join.
                        AuditLog::query()->create([
                            'actor_id' => $actor->id,
                            'action' => AuditAction::ADMIN_VIEWED_SPEECH,
                            'subject_type' => Speech::class,
                            'subject_id' => $record->id,
                            'metadata' => [
                                'surface' => 'transcript',
                                'trashed' => $record->trashed(),
                                'present' => $transcript !== null,
                            ],
                            'created_at' => now(),
                        ]);

                        return view('filament.speech-transcript', [
                            'speech' => $record,
                            'transcript' => $transcript,
                        ]);
                    }),
                Action::make('viewAnnotations')
                    ->label('View annotations by reviewer')
                    // §5.4 hole 7: the ADMIN_VIEWED_COMMENTARY write used
                    // to live in a bare `->action()` below. A Filament
                    // action closure runs on modal SUBMIT; `modalContent()`
                    // runs on modal OPEN. So an admin who opened this
                    // modal, read every annotation and clicked away
                    // generated NO audit row — the single read this panel
                    // most needs to account for was the one read it did not
                    // record. `CoachApplicationResource::viewDocuments`
                    // has the identical fix with its own bug history
                    // written up at that call site; this is the second
                    // instance of the same mistake, which is why both now
                    // audit from `modalContent()`.
                    //
                    // Consequence worth naming: opening the modal is now
                    // itself the audited event, so a double-click writes
                    // two rows. That is the correct trade — over-recording
                    // a read is recoverable, under-recording it is not —
                    // and it is why `->modalSubmitAction(false)` is set
                    // below: with the write moved to open, the submit
                    // button did nothing at all.
                    //
                    // §6.3 (Phase 2b) widens this modal twice: voice-note
                    // audio and the review's essay. Both are v1, not
                    // nice-to-have, and `Report::REPORTABLE_TYPES` is the
                    // reason — it resolves `Speech` AND **`Review`**, so
                    // a moderator can receive a report about a coach's
                    // voice commentary or essay and, before this, had no
                    // way to hear or read either. The modal rendered
                    // `{{ $annotation->body }}`, which is NULL for a
                    // voice note, so a reported voice note showed up here
                    // as an annotation with nothing in it.
                    ->modalWidth(Width::ThreeExtraLarge)
                    ->modalSubmitAction(false)
                    ->modalContent(function (Speech $record) {
                        // Was `auth()->user()` + `abort_if($actor ===
                        // null, 403)` and nothing more, which was
                        // defensible while this modal rendered only text
                        // that `scopeVisibleTo` had already filtered. It
                        // is not defensible now that the same closure
                        // MINTS PRESIGNED AUDIO URLS: see
                        // `adminActor()`'s docblock. A non-admin reaching
                        // this closure also used to stamp an
                        // `ADMIN_VIEWED_COMMENTARY` row with their own id.
                        $actor = self::adminActor();
                        $signer = app(MediaUrlSigner::class);
                        $essays = app(EssayService::class);

                        $groups = self::commentaryGroups($record, $actor, $signer, $essays);

                        // ⚠️ Audit moved to AFTER the groups are built,
                        // and the move is deliberate. It still fires on
                        // modal OPEN — that is §5.4 hole 7's fix and it
                        // is untouched; `->modalSubmitAction(false)`
                        // below still means there is no submit path at
                        // all. What changed is that this row now reports
                        // WHAT WAS HANDED OUT (how many bearer tokens
                        // were minted, how many essays disclosed), and a
                        // row claiming URLs were minted before they were
                        // is the same class of lie as auditing at submit
                        // time. `AuditLog`'s own docblock states the
                        // rule: "written only from controllers/services,
                        // immediately after the real action succeeds."
                        // If presigning throws, nothing reached the admin
                        // and no row is the honest outcome.
                        $presigned = $groups->sum(fn (array $group) => count($group['audio']));
                        $disclosed = $groups->sum(
                            fn (array $group) => $group['essays']->filter(fn (array $essay) => $essay['text'] !== null)->count()
                        );

                        AuditLog::query()->create([
                            'actor_id' => $actor->id,
                            'action' => AuditAction::ADMIN_VIEWED_COMMENTARY,
                            'subject_type' => Speech::class,
                            'subject_id' => $record->id,
                            'metadata' => [
                                'voice_notes_presigned' => $presigned,
                                'essays_disclosed' => $disclosed,
                            ],
                            'created_at' => now(),
                        ]);

                        return view('filament.speech-annotations-by-reviewer', [
                            'groups' => $groups,
                        ]);
                    }),
                // §6.3, third surface: "Then video." Everything the class
                // docblock says about bearer tokens, post-takedown
                // retrievability and the 1-hour TTL applies to this
                // action specifically — read it before changing anything
                // here.
                //
                // `visible()` is the affordance; `playableVideo()` called
                // AGAIN inside `modalContent()` is the enforcement. They
                // are not duplicated by accident: Filament's
                // `mountAction()` does not consult `isVisible()`, so a
                // hidden action is still mountable (see
                // `playableVideo()`'s docblock for the vendor line
                // numbers). This table loads trashed rows on purpose, so
                // the generation-time call is the only thing standing
                // between a crafted Livewire request and a working URL
                // for taken-down content.
                Action::make('viewVideo')
                    ->label('Watch video')
                    ->visible(fn (Speech $record) => self::playableVideo($record) !== null)
                    ->modalWidth(Width::FourExtraLarge)
                    ->modalSubmitAction(false)
                    ->modalContent(function (Speech $record) {
                        $actor = self::adminActor();

                        $asset = self::playableVideo($record);

                        // Refused, not aborted — and the distinction is a
                        // product one, not a security one. An
                        // unauthorized actor never gets this far
                        // (`adminActor()` aborts above). Reaching here
                        // with `$asset === null` means an ADMIN mounted
                        // an action whose state gate says no: the speech
                        // was taken down, the transcode never finished,
                        // or there is no primary rendition at all. A raw
                        // 403 page would tell a moderator nothing;
                        // saying which it is, while minting no URL and
                        // writing no audit row, tells them everything.
                        if ($asset === null) {
                            return view('filament.speech-video', [
                                'speech' => $record,
                                'asset' => null,
                                'url' => null,
                                'refusal' => $record->trashed()
                                    ? 'This speech has been taken down. Panel playback is refused for trashed content — restore it first if the video itself needs reviewing.'
                                    : 'There is no ready primary video rendition for this speech. A queued or failed transcode is never signed (§9.4 rule 3: status is the only playback-readiness signal).',
                            ]);
                        }

                        // AUTHORIZED, then STATE-GATED, then signed —
                        // never the other way round. `MediaUrlSigner::
                        // presign()` enforces no authorization of its own
                        // at all; it is a pure `(path, ttl) -> URL`
                        // function, so the two guards above are the
                        // entire access decision for these bytes.
                        $url = app(MediaUrlSigner::class)->presign($asset->path, self::PANEL_MEDIA_TTL_SECONDS);

                        // The audit for the mint, on OPEN. `asset_id` and
                        // `ttl_seconds` are recorded because the row's
                        // honest claim is "a URL to THIS object, good for
                        // THIS long, was handed to this admin" — it
                        // cannot claim the admin watched anything, and
                        // the TTL is the only thing in the row that
                        // bounds how long the grant outlived the click.
                        // The URL itself is deliberately NOT stored: it
                        // is a live credential, and `audit_log` is the
                        // one table in this schema with no delete path.
                        AuditLog::query()->create([
                            'actor_id' => $actor->id,
                            'action' => AuditAction::ADMIN_VIEWED_SPEECH,
                            'subject_type' => Speech::class,
                            'subject_id' => $record->id,
                            'metadata' => [
                                'surface' => 'video',
                                'asset_id' => $asset->id,
                                'ttl_seconds' => self::PANEL_MEDIA_TTL_SECONDS,
                            ],
                            'created_at' => now(),
                        ]);

                        return view('filament.speech-video', [
                            'speech' => $record,
                            'asset' => $asset,
                            'url' => $url,
                            'refusal' => null,
                        ]);
                    }),
                Action::make('takedown')
                    ->label('Take down')
                    ->requiresConfirmation()
                    ->visible(fn (Speech $record) => ! $record->trashed())
                    // §5.5: the reason is REQUIRED, and this is the
                    // cheapest high-value item in the whole plan. Takedown
                    // wrote `metadata: []` and notified nobody, so the
                    // platform's only destructive verb on content produced
                    // neither a statement of reasons nor notice to the
                    // affected speaker. Same `requiresConfirmation()` +
                    // `->schema([...required()])` shape as
                    // `CoachApplicationResource::reject`, which is the
                    // existing precedent for "a decision that must be
                    // justified in writing".
                    ->schema([
                        Textarea::make('reason')
                            ->label('Reason')
                            ->helperText('Recorded in the audit log and sent to the speaker verbatim.')
                            ->required()
                            ->maxLength(1000),
                    ])
                    ->action(function (Speech $record, array $data) {
                        $actor = auth()->user();
                        abort_if($actor === null, 403);

                        try {
                            // §5.4 hole 2. This Gate is the entire fix:
                            // before it, `EnsureUserIsAdmin` was the ONLY
                            // thing standing between any admin-tier session
                            // and the removal of any speech on the
                            // platform, with no policy consulted and no
                            // ability string even defined. Caught the same
                            // way `UserResource`'s actions catch theirs, so
                            // a denial renders a Notification instead of
                            // Filament's raw 403 page.
                            Gate::authorize('speech.takedown', $record);

                            $record->delete();

                            AuditLog::query()->create([
                                'actor_id' => $actor->id,
                                'action' => AuditAction::SPEECH_TAKEN_DOWN,
                                'subject_type' => Speech::class,
                                'subject_id' => $record->id,
                                'metadata' => ['reason' => $data['reason']],
                                'created_at' => now(),
                            ]);

                            // §5.6: the row is soft-deleted, every byte is
                            // still in the bucket. The purge is a separate
                            // job (and a separate SPEECH_MEDIA_PURGED audit
                            // row) precisely because a takedown is
                            // immediate while the purge runs after the
                            // quarantine window — writing one row for both
                            // would record a deletion that has not
                            // happened yet.
                            PurgeSpeechMedia::dispatch($record);

                            // §5.5: notice to the affected user. Sent
                            // AFTER the delete + audit, never before — a
                            // notification for a takedown that then failed
                            // would be worse than no notification at all.
                            $record->user->notify(new SpeechTakenDown($record, $data['reason']));

                            Notification::make()->success()->title('Speech taken down.')->send();
                        } catch (AuthorizationException $e) {
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
                    }),
                // §6.3's "Also add: restore (un-takedown)". Takedown is a
                // soft delete, so the bytes and the row both survive — but
                // the panel showed `deleted_at` with no way back, making a
                // reversible action irreversible through the only UI that
                // can perform it. SPEECH_RESTORED exists for this call site
                // (§5.7: `SPEECH_TAKEN_DOWN` alone would leave a restored
                // speech looking permanently removed in the audit history).
                //
                // No required reason, deliberately: §5.5's reason field is
                // about adverse decisions that need a statement to the
                // affected user. Reversing one needs no justification TO
                // that user, and demanding one would make the corrective
                // action the harder of the two to take.
                Action::make('restore')
                    ->label('Restore')
                    ->requiresConfirmation()
                    ->visible(fn (Speech $record) => $record->trashed())
                    ->action(function (Speech $record) {
                        $actor = auth()->user();
                        abort_if($actor === null, 403);

                        try {
                            Gate::authorize('speech.restore', $record);

                            $record->restore();

                            AuditLog::query()->create([
                                'actor_id' => $actor->id,
                                'action' => AuditAction::SPEECH_RESTORED,
                                'subject_type' => Speech::class,
                                'subject_id' => $record->id,
                                'metadata' => [],
                                'created_at' => now(),
                            ]);

                            Notification::make()->success()->title('Speech restored.')->send();
                        } catch (AuthorizationException $e) {
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
                    }),
            ]);
    }

    /**
     * @return array<string, PageRegistration>
     */
    public static function getPages(): array
    {
        return [
            'index' => ManageSpeeches::route('/'),
        ];
    }
}
