<?php

namespace Database\Seeders;

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Deterministic STEP-10 browser fixtures. This is deliberately separate
 * from E2ESeeder: the baseline auth/isolation tests should not pay for
 * writing real media objects, and this mutable slice can be reset without
 * disturbing their shared speech.
 *
 * The MP4 and M4A are genuine, committed media. The M4A is shared with the
 * queued Whisper smoke rather than copying 155 KiB under a second name;
 * tests/fixtures/e2e-voice/README.md freezes its checksum and provenance.
 */
class E2EVoiceAnnotationSeeder extends Seeder
{
    private const FIXTURE_TIMESTAMP = '2026-01-01 00:00:00';

    private const VIDEO_FIXTURE = __DIR__.'/../../tests/fixtures/e2e-captions/caption-fixture.mp4';

    private const VOICE_FIXTURE = __DIR__.'/../../tests/fixtures/whisper-smoke/spoken-fixture.m4a';

    public const COACH_SPEECH_ID = 9601;

    public const MEMBER_REVIEW_SPEECH_ID = 9602;

    public const ERASURE_SPEECH_ID = 9603;

    public const COACH_REVIEW_ID = 9611;

    public const MEMBER_REVIEW_ID = 9612;

    public const ERASURE_REVIEW_ID = 9613;

    public const PEER_DRAFT_REVIEW_ID = 9614;

    public const FIRST_VOICE_ANNOTATION_ID = 9801;

    public function run(): void
    {
        $this->resetOwnedRows();

        $timestamp = Carbon::parse(self::FIXTURE_TIMESTAMP);
        $coachSpeech = $this->speech(
            self::COACH_SPEECH_ID,
            E2ESeeder::MEMBER_ID,
            'E2E voice commentary speech',
            'A playable speech with seven published voice notes and one ordinary text note.',
            $timestamp,
        );
        $memberSpeech = $this->speech(
            self::MEMBER_REVIEW_SPEECH_ID,
            E2ESeeder::COACH_ID,
            'E2E member voice boundary speech',
            'A playable speech reviewed by a Member, proving the dedicated voice endpoint denies them.',
            $timestamp,
        );
        $erasureSpeech = $this->speech(
            self::ERASURE_SPEECH_ID,
            E2ESeeder::MEMBER_ID,
            'E2E voice erasure speech',
            'A published voice transcript whose reviewer can run the queued erase-self path.',
            $timestamp,
        );

        $this->video($coachSpeech, 9701, $timestamp);
        $this->video($memberSpeech, 9702, $timestamp);
        $this->video($erasureSpeech, 9703, $timestamp);

        $coachReview = $this->review(
            self::COACH_REVIEW_ID,
            $coachSpeech,
            E2ESeeder::COACH_ID,
            E2ESeeder::MEMBER_ID,
            'published',
            8,
            8,
            $timestamp,
        );
        $this->review(
            self::MEMBER_REVIEW_ID,
            $memberSpeech,
            E2ESeeder::MEMBER_ID,
            E2ESeeder::COACH_ID,
            'accepted',
            0,
            0,
            $timestamp,
        );
        $this->review(
            self::PEER_DRAFT_REVIEW_ID,
            $coachSpeech,
            E2ESeeder::COACH_B_ID,
            E2ESeeder::MEMBER_ID,
            'accepted',
            1,
            0,
            $timestamp,
        );
        $erasureReview = $this->review(
            self::ERASURE_REVIEW_ID,
            $erasureSpeech,
            E2ESeeder::COACH_B_ID,
            E2ESeeder::MEMBER_ID,
            'published',
            1,
            1,
            $timestamp,
        );

        for ($offset = 0; $offset < 7; $offset++) {
            $assetId = 9711 + $offset;
            $annotationId = self::FIRST_VOICE_ANNOTATION_ID + $offset;
            $this->voiceAsset($coachSpeech, $assetId, $offset, $timestamp);

            DB::table('annotations')->insert([
                'id' => $annotationId,
                'review_id' => $coachReview->id,
                'client_uuid' => sprintf('0e2e0000-0000-4000-8000-%012d', $annotationId),
                'body' => $offset === 0 ? '' : 'Seeded voice transcript '.($offset + 1),
                'start_seconds' => 0.75 + ($offset * 0.65),
                'duration_seconds' => 3.518,
                'kind' => 'observation',
                'topic' => null,
                'published_at' => $timestamp,
                'lock_version' => $offset === 0 ? 0 : 1,
                'audio_asset_id' => $assetId,
                'transcript_status' => $offset === 0 ? 'pending' : 'ready',
                'transcript_failure_code' => null,
                'transcript_attempt_id' => sprintf('1e2e0000-0000-4000-8000-%012d', $annotationId),
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);
        }

        DB::table('annotations')->insert([
            'id' => 9808,
            'review_id' => $coachReview->id,
            'client_uuid' => '0e2e0000-0000-4000-8000-000000009808',
            'body' => 'Ordinary text remains visible.',
            'start_seconds' => 0.1,
            'duration_seconds' => 5.0,
            'kind' => 'praise',
            'topic' => null,
            'published_at' => $timestamp,
            'lock_version' => 1,
            'audio_asset_id' => null,
            'transcript_status' => 'not_applicable',
            'transcript_failure_code' => null,
            'transcript_attempt_id' => null,
            'created_at' => $timestamp,
            'updated_at' => $timestamp,
        ]);

        $this->voiceAsset($coachSpeech, 9722, 8, $timestamp);
        DB::table('annotations')->insert([
            'id' => 9822,
            'review_id' => self::PEER_DRAFT_REVIEW_ID,
            'client_uuid' => '0e2e0000-0000-4000-8000-000000009822',
            'body' => 'A private draft voice transcript.',
            'start_seconds' => 1.0,
            'duration_seconds' => 3.518,
            'kind' => 'correction',
            'topic' => null,
            'published_at' => null,
            'lock_version' => 1,
            'audio_asset_id' => 9722,
            'transcript_status' => 'ready',
            'transcript_failure_code' => null,
            'transcript_attempt_id' => '1e2e0000-0000-4000-8000-000000009822',
            'created_at' => $timestamp,
            'updated_at' => $timestamp,
        ]);

        $this->voiceAsset($erasureSpeech, 9721, 9, $timestamp);
        DB::table('annotations')->insert([
            'id' => 9821,
            'review_id' => $erasureReview->id,
            'client_uuid' => '0e2e0000-0000-4000-8000-000000009821',
            'body' => 'This transcript survives reviewer erasure.',
            'start_seconds' => 1.0,
            'duration_seconds' => 3.518,
            'kind' => 'observation',
            'topic' => null,
            'published_at' => $timestamp,
            'lock_version' => 1,
            'audio_asset_id' => 9721,
            'transcript_status' => 'ready',
            'transcript_failure_code' => null,
            'transcript_attempt_id' => '1e2e0000-0000-4000-8000-000000009821',
            'created_at' => $timestamp,
            'updated_at' => $timestamp,
        ]);
    }

    private function resetOwnedRows(): void
    {
        $reviewIds = [self::COACH_REVIEW_ID, self::MEMBER_REVIEW_ID, self::ERASURE_REVIEW_ID, self::PEER_DRAFT_REVIEW_ID];
        $speechIds = [self::COACH_SPEECH_ID, self::MEMBER_REVIEW_SPEECH_ID, self::ERASURE_SPEECH_ID];
        DB::table('annotations')->whereIn('review_id', $reviewIds)->delete();
        DB::table('speech_assets')->whereIn('speech_id', $speechIds)->delete();
        DB::table('reviews')->whereIn('id', $reviewIds)->delete();
        DB::table('speeches')->whereIn('id', $speechIds)->delete();
        Storage::disk('media')->deleteDirectory('e2e-voice');

        // Scenario F deliberately advances this user-level claim. Clear it
        // with the rest of this seeder's mutable slice so retries start from
        // the same pre-erasure state rather than inheriting a previous job.
        User::query()->whereKey(E2ESeeder::COACH_B_ID)->update(['erasure_started_at' => null]);

        $speaker = User::query()->find(E2ESeeder::MEMBER_ID);
        if ($speaker !== null) {
            $preferences = $speaker->preferences;
            $voicePreferences = is_array($preferences['voice_commentary'] ?? null)
                ? $preferences['voice_commentary']
                : [];
            unset($voicePreferences[(string) self::COACH_SPEECH_ID]);
            if ($voicePreferences === []) {
                unset($preferences['voice_commentary']);
            } else {
                $preferences['voice_commentary'] = $voicePreferences;
            }
            $speaker->update(['preferences' => $preferences]);
        }
    }

    private function speech(int $id, int $ownerId, string $title, string $description, Carbon $timestamp): Speech
    {
        DB::table('speeches')->insert([
            'id' => $id,
            'ulid' => sprintf('01JQE2EVOICE%014d', $id),
            'playback_key' => sprintf('9d1e5f00-0000-4000-8000-%012d', $id),
            'user_id' => $ownerId,
            'title' => $title,
            'description' => $description,
            'is_example' => false,
            'captions_enabled' => false,
            'created_at' => $timestamp,
            'updated_at' => $timestamp,
        ]);

        return Speech::query()->findOrFail($id);
    }

    private function review(
        int $id,
        Speech $speech,
        int $reviewerId,
        int $ownerId,
        string $status,
        int $annotationCount,
        int $publishedCount,
        Carbon $timestamp,
    ): Review {
        DB::table('reviews')->insert([
            'id' => $id,
            'speech_id' => $speech->id,
            'reviewer_id' => $reviewerId,
            'speech_owner_id' => $ownerId,
            'invited_by_id' => $ownerId,
            'invitation_message' => 'Deterministic STEP-10 fixture invitation.',
            'allow_preview' => false,
            'prior_commentary_shared' => false,
            'status' => $status,
            'invited_at' => $timestamp,
            'responded_at' => $timestamp,
            'first_published_at' => $publishedCount > 0 ? $timestamp : null,
            'last_published_at' => $publishedCount > 0 ? $timestamp : null,
            'last_transition_at' => $timestamp,
            'annotations_count' => $annotationCount,
            'published_annotations_count' => $publishedCount,
            'created_at' => $timestamp,
            'updated_at' => $timestamp,
        ]);

        return Review::query()->findOrFail($id);
    }

    private function video(Speech $speech, int $assetId, Carbon $timestamp): void
    {
        $this->storeAssetBytes(self::VIDEO_FIXTURE, "e2e-voice/{$speech->id}/source.mp4", 'video/mp4');
        $size = Storage::disk('media')->size("e2e-voice/{$speech->id}/source.mp4");

        DB::table('speech_assets')->insert([
            'id' => $assetId,
            'speech_id' => $speech->id,
            'kind' => 'video',
            'format' => 'mp4',
            'rendition' => 'source',
            'disk' => 'media',
            'path' => "e2e-voice/{$speech->id}/source.mp4",
            'original_filename' => 'caption-fixture.mp4',
            'mime_type' => 'video/mp4',
            'byte_size' => $size,
            'duration_seconds' => 6.0,
            'status' => 'ready',
            'failure_code' => null,
            'failure_detail' => null,
            'is_primary' => true,
            'width' => 640,
            'height' => 360,
            'created_at' => $timestamp,
            'updated_at' => $timestamp,
        ]);
    }

    private function voiceAsset(Speech $speech, int $assetId, int $offset, Carbon $timestamp): void
    {
        $path = "e2e-voice/{$speech->id}/voice/{$assetId}.m4a";
        $this->storeAssetBytes(self::VOICE_FIXTURE, $path, 'audio/mp4');

        DB::table('speech_assets')->insert([
            'id' => $assetId,
            'speech_id' => $speech->id,
            'kind' => 'voice_note',
            'format' => 'm4a',
            'rendition' => null,
            'disk' => 'media',
            'path' => $path,
            'original_filename' => "voice-fixture-{$offset}.m4a",
            'mime_type' => 'audio/mp4',
            'byte_size' => Storage::disk('media')->size($path),
            'duration_seconds' => 3.518,
            'status' => 'ready',
            'failure_code' => null,
            'failure_detail' => null,
            'is_primary' => false,
            'created_at' => $timestamp,
            'updated_at' => $timestamp,
        ]);
    }

    private function storeAssetBytes(string $fixture, string $path, string $contentType): void
    {
        $bytes = file_get_contents($fixture);
        if ($bytes === false) {
            throw new \RuntimeException("E2EVoiceAnnotationSeeder: could not read {$fixture}");
        }
        if (! Storage::disk('media')->put($path, $bytes, ['ContentType' => $contentType])) {
            throw new \RuntimeException("E2EVoiceAnnotationSeeder: could not write {$path}");
        }
        if (Storage::disk('media')->size($path) !== strlen($bytes)) {
            throw new \RuntimeException("E2EVoiceAnnotationSeeder: stored size mismatch for {$path}");
        }
    }
}
