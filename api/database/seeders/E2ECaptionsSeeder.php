<?php

namespace Database\Seeders;

use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Services\Captions\TranscriptDeriver;
use App\Services\Captions\Vtt;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-09-VERIFICATION-PLAN.md §3.3. A separately-invoked media/caption
 * seeder with its own fixed IDs (9401-9409 for speeches, 9411-9413 for
 * reviews, 9501+ for assets) — deliberately never touching E2ESeeder's
 * shared speech 9101, which CP-05/CP-08 already depend on.
 *
 * Re-running this seeder resets its mutable rows and overwrites its media
 * objects (every method here is `updateOrCreate`/`updateOrInsert`/an
 * explicit overwrite — nothing is create-once). The one deliberate
 * exception is the processing fixture's liveness clocks
 * (`caption_queued_at`/`caption_heartbeat_at`): those get a fresh "now" on
 * every seed run, per the plan's explicit carve-out, so the fixture is
 * never born already stale enough for a recovery sweep to claim it.
 *
 * Depends on E2ESeeder having already run (needs the fixture users/roles).
 * `run()` does not call E2ESeeder itself — STEP-09-VERIFICATION-PLAN.md §3.3:
 * "CI runs the existing lightweight E2ESeeder first (users/auth), then this
 * media seeder explicitly." Do not make every existing SQLite test that
 * calls E2ESeeder pay for media setup by folding this in there.
 */
class E2ECaptionsSeeder extends Seeder
{
    private const FIXTURE_TIMESTAMP = '2026-01-01 00:00:00';

    private const MODEL_ID = 'e2e-fixture';

    private const MEDIA_FIXTURE_PATH = __DIR__.'/../../tests/fixtures/e2e-captions/caption-fixture.mp4';

    // Real media duration of tests/fixtures/e2e-captions/caption-fixture.mp4
    // (see that fixture's own README) — every cue/annotation timestamp
    // below is chosen to fall strictly inside [0, 6).
    private const MEDIA_DURATION_SECONDS = 6.0;

    public const CAPTION_DISPLAY_SPEECH_ID = 9401;

    public const REVIEWER_ACCESS_SPEECH_ID = 9402;

    public const CAPTION_EDIT_SPEECH_ID = 9403;

    public const SEARCH_EDIT_SPEECH_ID = 9404;

    public const CAPTION_PROCESSING_SPEECH_ID = 9405;

    public const CAPTION_FAILED_SPEECH_ID = 9406;

    public const SEARCH_OWNER_MATCH_SPEECH_ID = 9407;

    public const SEARCH_OWNER_NONMATCH_SPEECH_ID = 9408;

    public const SEARCH_OTHER_USER_MATCH_SPEECH_ID = 9409;

    public const REVIEW_DISPLAY_COACH_A_ID = 9411;

    public const REVIEW_DISPLAY_COACH_B_ID = 9412;

    public const REVIEW_ACCESS_COACH_A_ID = 9413;

    /**
     * The edit fixture's original, not-yet-corrected phrase — Scenario B
     * changes this to "Toastmasters" through the real owner UI. Kept as a
     * constant so `web/tests/fixtures.ts` mirrors it exactly (STEP-09
     * verification plan §3.3: "mirrored IDs/text ... so drift fails
     * loudly").
     */
    public const EDIT_FIXTURE_UNCORRECTED_PHRASE = 'toast masters';

    public const EDIT_FIXTURE_SECOND_STABLE_PHRASE = 'thank you for joining us today';

    /** The published annotation's body on the caption-display speech. */
    public const DISPLAY_ANNOTATION_BODY = 'Great energy in the opening — keep that pace.';

    /** Search-control fixtures' shared distinctive phrase. */
    public const SEARCH_DISTINCTIVE_PHRASE = 'quarterly toastmasters keynote address';

    public function run(): void
    {
        $memberId = E2ESeeder::MEMBER_ID;
        $coachId = E2ESeeder::COACH_ID;
        $coachBId = E2ESeeder::COACH_B_ID;

        $this->seedCaptionDisplaySpeech($memberId, $coachId, $coachBId);
        $this->seedReviewerAccessSpeech($memberId, $coachId);
        $this->seedCaptionEditSpeech($memberId);
        $this->seedSearchEditSpeech($memberId);
        $this->seedCaptionProcessingSpeech($memberId);
        $this->seedCaptionFailedSpeech($memberId);
        $this->seedSearchControlSpeeches($memberId, $coachBId);
    }

    /**
     * Caption-display speech: ready video, ready two-cue VTT, a derived
     * transcript, reviewer A (coach) published, reviewer B (coach_b)
     * merely invited (not accepted — the RBAC-denial positive control),
     * and one published annotation overlapping the first cue's window so
     * Scenario A can measure caption-vs-annotation layout independence.
     */
    private function seedCaptionDisplaySpeech(int $memberId, int $coachId, int $coachBId): void
    {
        $timestamp = Carbon::parse(self::FIXTURE_TIMESTAMP);

        $speech = $this->upsertSpeech(
            self::CAPTION_DISPLAY_SPEECH_ID,
            $memberId,
            'E2E caption-display speech',
            'Fixture speech with ready captions, a derived transcript, and one published annotation.',
            $timestamp,
        );

        $this->seedVideoAsset($speech, 9501, $timestamp);
        $this->seedReadyCaptions(
            $speech,
            9511,
            $timestamp,
            $this->twoCueVtt('welcome to the toastmasters showcase', 'please give a warm hand to our next speaker'),
        );

        $review = Review::query()->updateOrCreate(
            ['id' => self::REVIEW_DISPLAY_COACH_A_ID],
            [
                'speech_id' => $speech->id,
                'reviewer_id' => $coachId,
                'speech_owner_id' => $memberId,
                'invited_by_id' => $memberId,
                'invitation_message' => 'Fixture invitation.',
                'allow_preview' => false,
                'prior_commentary_shared' => false,
                'status' => 'published',
                'invited_at' => $timestamp,
                'responded_at' => $timestamp,
                'first_published_at' => $timestamp,
                'last_published_at' => $timestamp,
                'last_transition_at' => $timestamp,
                'annotations_count' => 1,
                'published_annotations_count' => 1,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]
        );

        Review::query()->updateOrCreate(
            ['id' => self::REVIEW_DISPLAY_COACH_B_ID],
            [
                'speech_id' => $speech->id,
                'reviewer_id' => $coachBId,
                'speech_owner_id' => $memberId,
                'invited_by_id' => $memberId,
                'invitation_message' => 'Fixture invitation, not yet accepted — RBAC denial control.',
                'allow_preview' => false,
                'prior_commentary_shared' => false,
                'status' => 'invited',
                'invited_at' => $timestamp,
                'last_transition_at' => $timestamp,
                'annotations_count' => 0,
                'published_annotations_count' => 0,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]
        );

        // Overlaps the first cue (0.5s-2.5s): Scenario A requires the
        // annotation's window to genuinely overlap a caption cue so the
        // upper/lower-half geometry assertion means something.
        Annotation::query()->updateOrCreate(
            ['review_id' => $review->id, 'client_uuid' => '0e2e0000-0000-4000-8000-000000009401'],
            [
                'body' => self::DISPLAY_ANNOTATION_BODY,
                'start_seconds' => 1.0,
                'duration_seconds' => 1.5,
                'kind' => 'observation',
                'topic' => null,
                'published_at' => $timestamp,
                'lock_version' => 1,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]
        );
    }

    /**
     * Reviewer-access speech: a second, independent ready-captions speech
     * where reviewer A is `accepted` (not `published`) — proves the
     * positive-access read path without conflating it with reviewer A's
     * separately published commentary lifecycle on the display speech.
     */
    private function seedReviewerAccessSpeech(int $memberId, int $coachId): void
    {
        $timestamp = Carbon::parse(self::FIXTURE_TIMESTAMP);

        $speech = $this->upsertSpeech(
            self::REVIEWER_ACCESS_SPEECH_ID,
            $memberId,
            'E2E reviewer-access speech',
            'Fixture speech proving accepted-reviewer read-only caption/transcript access.',
            $timestamp,
        );

        $this->seedVideoAsset($speech, 9502, $timestamp);
        $this->seedReadyCaptions(
            $speech,
            9512,
            $timestamp,
            $this->twoCueVtt('this is the second fixture speech', 'click any line below to seek the video'),
        );

        Review::query()->updateOrCreate(
            ['id' => self::REVIEW_ACCESS_COACH_A_ID],
            [
                'speech_id' => $speech->id,
                'reviewer_id' => $coachId,
                'speech_owner_id' => $memberId,
                'invited_by_id' => $memberId,
                'invitation_message' => 'Fixture invitation.',
                'allow_preview' => false,
                'prior_commentary_shared' => false,
                'status' => 'accepted',
                'invited_at' => $timestamp,
                'responded_at' => $timestamp,
                'last_transition_at' => $timestamp,
                'annotations_count' => 0,
                'published_annotations_count' => 0,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]
        );
    }

    /**
     * Caption-edit speech: owner-only, isolated from the display fixture
     * so Scenario B's PUT/re-derive mutations can never corrupt what
     * Scenario A reads. Cue text carries the exact
     * EDIT_FIXTURE_UNCORRECTED_PHRASE the spec corrects to "Toastmasters".
     */
    private function seedCaptionEditSpeech(int $memberId): void
    {
        $timestamp = Carbon::parse(self::FIXTURE_TIMESTAMP);

        $speech = $this->upsertSpeech(
            self::CAPTION_EDIT_SPEECH_ID,
            $memberId,
            'E2E caption-edit speech',
            'Fixture speech dedicated to caption-editor PUT/re-derive mutation tests.',
            $timestamp,
        );

        $this->seedVideoAsset($speech, 9503, $timestamp);
        $this->seedReadyCaptions(
            $speech,
            9513,
            $timestamp,
            $this->twoCueVtt(
                self::EDIT_FIXTURE_UNCORRECTED_PHRASE.' opening remarks',
                self::EDIT_FIXTURE_SECOND_STABLE_PHRASE,
            ),
        );
    }

    /**
     * Search-edit speech: its own ready VTT/transcript, isolated from the
     * caption-edit fixture, so the search-cache-convergence scenario can
     * mutate it without racing Scenario B's assertions on the same row.
     */
    private function seedSearchEditSpeech(int $memberId): void
    {
        $timestamp = Carbon::parse(self::FIXTURE_TIMESTAMP);

        $speech = $this->upsertSpeech(
            self::SEARCH_EDIT_SPEECH_ID,
            $memberId,
            'E2E search-edit speech',
            'Fixture speech dedicated to search-cache convergence after an edit.',
            $timestamp,
        );

        $this->seedVideoAsset($speech, 9504, $timestamp);
        $this->seedReadyCaptions(
            $speech,
            9514,
            $timestamp,
            $this->twoCueVtt('morning session notes begin here', 'closing thoughts for today\'s meeting'),
        );
    }

    /**
     * Caption-processing speech: playable video, captions asset stuck at
     * `processing`, no transcript row yet. `created_at`/`updated_at` are
     * intentionally reset to "now" on every seed run — the one exception
     * to this class's otherwise-literal fixture timestamps — so
     * `media:reconcile`'s current `created_at`-based staleness sweep
     * (App\Console\Commands\MediaReconcileCommand) never finds this
     * fixture already stale the moment it's seeded.
     *
     * NOTE: STEP-09-VERIFICATION-PLAN.md §4.1 calls for dedicated
     * `caption_attempt_id`/`caption_queued_at`/`caption_started_at`/
     * `caption_heartbeat_at` columns on `speech_assets` as the real
     * recovery clocks. Those columns do not exist in the schema yet (that
     * attempt-token/heartbeat machinery is separate, not-yet-built work) —
     * this fixture uses `created_at`/`updated_at` only, matching what the
     * reconciler actually reads today. Revisit once §4.1 lands.
     */
    private function seedCaptionProcessingSpeech(int $memberId): void
    {
        $timestamp = Carbon::parse(self::FIXTURE_TIMESTAMP);
        $now = Carbon::now();

        $speech = $this->upsertSpeech(
            self::CAPTION_PROCESSING_SPEECH_ID,
            $memberId,
            'E2E caption-processing speech',
            'Fixture speech whose captions never finish — Scenario E processing UI.',
            $timestamp,
        );

        $this->seedVideoAsset($speech, 9505, $timestamp);

        SpeechAsset::query()->updateOrInsert(
            ['id' => 9515],
            [
                'speech_id' => $speech->id,
                'kind' => 'captions',
                'format' => 'vtt',
                'rendition' => null,
                'disk' => 'media',
                'path' => "e2e-captions/{$speech->id}/captions.vtt",
                'original_filename' => null,
                'mime_type' => 'text/vtt',
                'byte_size' => null,
                'duration_seconds' => null,
                'status' => 'processing',
                'failure_code' => null,
                'failure_detail' => null,
                'is_primary' => false,
                'created_at' => $now,
                'updated_at' => $now,
            ]
        );
    }

    /**
     * Caption-failed speech: playable video, captions asset `failed` with
     * a stable, user-safe failure code — never a raw exception string.
     */
    private function seedCaptionFailedSpeech(int $memberId): void
    {
        $timestamp = Carbon::parse(self::FIXTURE_TIMESTAMP);

        $speech = $this->upsertSpeech(
            self::CAPTION_FAILED_SPEECH_ID,
            $memberId,
            'E2E caption-failed speech',
            'Fixture speech whose captions failed — Scenario E failure/retry UI.',
            $timestamp,
        );

        $this->seedVideoAsset($speech, 9506, $timestamp);

        SpeechAsset::query()->updateOrInsert(
            ['id' => 9516],
            [
                'speech_id' => $speech->id,
                'kind' => 'captions',
                'format' => 'vtt',
                'rendition' => null,
                'disk' => 'media',
                'path' => "e2e-captions/{$speech->id}/captions.vtt",
                'original_filename' => null,
                'mime_type' => 'text/vtt',
                'byte_size' => null,
                'duration_seconds' => null,
                'status' => 'failed',
                'failure_code' => 'transcription_failed',
                'failure_detail' => null,
                'is_primary' => false,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]
        );
    }

    /**
     * Search controls: a stable owner match, a stable owner non-match, and
     * another user's matching transcript that must never leak into the
     * member's own search results (TranscriptController::search scopes
     * strictly to `user_id === caller`).
     */
    private function seedSearchControlSpeeches(int $memberId, int $coachBId): void
    {
        $timestamp = Carbon::parse(self::FIXTURE_TIMESTAMP);

        $ownerMatch = $this->upsertSpeech(
            self::SEARCH_OWNER_MATCH_SPEECH_ID,
            $memberId,
            'E2E search owner-match speech',
            'Fixture speech whose transcript contains the shared search phrase.',
            $timestamp,
        );
        $this->seedVideoAsset($ownerMatch, 9507, $timestamp);
        $this->seedReadyCaptions(
            $ownerMatch,
            9517,
            $timestamp,
            $this->twoCueVtt('opening housekeeping notes', self::SEARCH_DISTINCTIVE_PHRASE),
        );

        $ownerNonMatch = $this->upsertSpeech(
            self::SEARCH_OWNER_NONMATCH_SPEECH_ID,
            $memberId,
            'E2E search owner-non-match speech',
            'Fixture speech whose transcript does not contain the shared search phrase.',
            $timestamp,
        );
        $this->seedVideoAsset($ownerNonMatch, 9508, $timestamp);
        $this->seedReadyCaptions(
            $ownerNonMatch,
            9518,
            $timestamp,
            $this->twoCueVtt('unrelated agenda item one', 'unrelated agenda item two'),
        );

        $otherUserMatch = $this->upsertSpeech(
            self::SEARCH_OTHER_USER_MATCH_SPEECH_ID,
            $coachBId,
            'E2E search other-user-match speech',
            'Fixture speech, owned by a different user, whose transcript also contains the shared search phrase.',
            $timestamp,
        );
        $this->seedVideoAsset($otherUserMatch, 9509, $timestamp);
        $this->seedReadyCaptions(
            $otherUserMatch,
            9519,
            $timestamp,
            $this->twoCueVtt(self::SEARCH_DISTINCTIVE_PHRASE, 'a second unrelated closing line'),
        );
    }

    private function upsertSpeech(int $id, int $ownerId, string $title, string $description, Carbon $timestamp): Speech
    {
        return Speech::query()->updateOrCreate(
            ['id' => $id],
            [
                'ulid' => sprintf('01JQE2ECAPTIONS%011d', $id),
                'playback_key' => sprintf('9d1e5f00-0000-4000-8000-%012d', $id),
                'user_id' => $ownerId,
                'title' => $title,
                'description' => $description,
                'is_example' => false,
                'captions_enabled' => true,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]
        );
    }

    /**
     * A real, playable `video` primary asset — unlike E2ESeeder's
     * SHARED_SPEECH_ASSET_ID row, this one is backed by a genuine object
     * written through Storage::disk('media') (STEP-09 verification plan
     * §3.3: "Store MP4/VTT through Storage::disk('media')... check every
     * write result, then verify stored size/content").
     */
    private function seedVideoAsset(Speech $speech, int $assetId, Carbon $timestamp): void
    {
        $disk = Storage::disk('media');
        $path = "e2e-captions/{$speech->id}/source.mp4";
        $bytes = file_get_contents(self::MEDIA_FIXTURE_PATH);

        if ($bytes === false) {
            throw new \RuntimeException('E2ECaptionsSeeder: could not read '.self::MEDIA_FIXTURE_PATH);
        }

        $written = $disk->put($path, $bytes, ['ContentType' => 'video/mp4']);

        if ($written === false) {
            throw new \RuntimeException("E2ECaptionsSeeder: Storage::disk('media')->put() failed for {$path}");
        }

        $storedSize = $disk->size($path);

        if ($storedSize !== strlen($bytes)) {
            throw new \RuntimeException(
                "E2ECaptionsSeeder: stored size mismatch for {$path} (expected ".strlen($bytes).", got {$storedSize})"
            );
        }

        SpeechAsset::query()->updateOrCreate(
            ['id' => $assetId],
            [
                'speech_id' => $speech->id,
                'kind' => 'video',
                'format' => 'mp4',
                'rendition' => 'source',
                'disk' => 'media',
                'path' => $path,
                'original_filename' => 'caption-fixture.mp4',
                'mime_type' => 'video/mp4',
                'byte_size' => $storedSize,
                'duration_seconds' => self::MEDIA_DURATION_SECONDS,
                'status' => 'ready',
                'is_primary' => true,
                'width' => 640,
                'height' => 360,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]
        );
    }

    /**
     * Writes a real `captions` asset (status `ready`) plus its derived
     * `speech_transcripts` row, both produced through the SAME production
     * `Vtt`/`TranscriptDeriver` classes the real pipeline uses — STEP-09
     * verification plan §3.3: "Derive the seeded transcript with the
     * production `Vtt` parser and `TranscriptDeriver`; never hand-maintain
     * body/segments separately from VTT."
     */
    private function seedReadyCaptions(Speech $speech, int $assetId, Carbon $timestamp, string $vtt): void
    {
        $disk = Storage::disk('media');
        $path = "e2e-captions/{$speech->id}/captions.vtt";

        $written = $disk->put($path, $vtt);

        if ($written === false) {
            throw new \RuntimeException("E2ECaptionsSeeder: Storage::disk('media')->put() failed for {$path}");
        }

        $storedContent = $disk->get($path);

        if ($storedContent !== $vtt) {
            throw new \RuntimeException("E2ECaptionsSeeder: stored VTT content mismatch for {$path}");
        }

        SpeechAsset::query()->updateOrCreate(
            ['id' => $assetId],
            [
                'speech_id' => $speech->id,
                'kind' => 'captions',
                'format' => 'vtt',
                'rendition' => null,
                'disk' => 'media',
                'path' => $path,
                'original_filename' => null,
                'mime_type' => 'text/vtt',
                'byte_size' => $disk->size($path),
                'duration_seconds' => null,
                'status' => 'ready',
                'failure_code' => null,
                'failure_detail' => null,
                'is_primary' => false,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]
        );

        $cues = Vtt::parse($vtt);
        $derived = (new TranscriptDeriver)->derive($cues);

        SpeechTranscript::query()->updateOrCreate(
            ['speech_id' => $speech->id],
            [
                'body' => $derived['body'],
                'segments' => $derived['segments'],
                'word_count' => $derived['word_count'],
                'words_per_minute' => $derived['words_per_minute'],
                'language' => 'en',
                'model' => self::MODEL_ID,
                'source' => 'whisper',
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]
        );
    }

    /**
     * A minimal, valid two-cue WebVTT string — both cues strictly inside
     * [0, 6) seconds (this class's MEDIA_DURATION_SECONDS), matching the
     * fixture media's real duration.
     */
    private function twoCueVtt(string $firstCueText, string $secondCueText): string
    {
        return Vtt::render([
            ['start' => 0.5, 'end' => 2.5, 'text' => $firstCueText],
            ['start' => 3.0, 'end' => 5.5, 'text' => $secondCueText],
        ]);
    }
}
