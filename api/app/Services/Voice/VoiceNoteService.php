<?php

namespace App\Services\Voice;

use App\Exceptions\AnnotationCapExceededException;
use App\Jobs\NormalizeVoiceNote;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\User;
use App\Services\QuotaService;
use App\Services\ReviewService;
use App\Support\AnnotationTiming;
use App\Support\AnnotationTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

class VoiceNoteService
{
    public function __construct(private readonly ReviewService $reviews, private readonly QuotaService $quota) {}

    /**
     * @param  array{client_uuid: string, start_seconds: float|int, kind?: string, topic?: string|null}  $data
     * @return array{0: Annotation, 1: bool}
     */
    public function create(Review $review, UploadedFile $audio, array $data): array
    {
        $result = null;
        $contents = $audio->getContent();

        try {
            $result = AnnotationTransactions::run(function () use ($review, $audio, $data): array {
                // Global voice-write lock order is identity -> review ->
                // asset/annotation. EraseSelfAccount uses the same order,
                // preventing a PostgreSQL create-vs-erasure deadlock.
                User::query()->whereKey($review->reviewer_id)->lockForUpdate()->firstOrFail();
                $locked = Review::query()->with(['reviewer', 'speech'])->whereKey($review->id)->lockForUpdate()->firstOrFail();
                Gate::authorize('voice.create', $locked);
                abort_if($locked->voice_erasure_started_at !== null || $locked->reviewer?->erasure_started_at !== null, 409, 'Account erasure is in progress.');
                $existing = Annotation::query()->with('audioAsset')
                    ->where('review_id', $locked->id)->where('client_uuid', $data['client_uuid'])->first();
                if ($existing !== null) {
                    return [$existing, false, null];
                }
                if ($locked->annotations_count >= 200) {
                    throw new AnnotationCapExceededException;
                }
                $start = app(AnnotationTiming::class)->point($locked, $data['start_seconds']);

                $bytes = (int) $audio->getSize();
                $reviewer = $locked->reviewer;
                // `reviewer_id` is nullable at the schema level (erasure
                // nulls it — see Review's own docblock), but a review
                // reaching this far is always a live, accepted grant owned
                // by the authenticated caller; the erasure check two lines
                // above already handles the in-progress case. This guard
                // is defense-in-depth against the row having gone fully
                // null between that check and here, not a live path.
                abort_if($reviewer === null, 409, 'Reviewer account is no longer available.');
                $this->quota->reserveDirect($reviewer, $bytes);

                // The object is written only after this transaction commits.
                // Therefore every stored input always has a durable asset-row
                // ledger; a hard kill before commit cannot orphan an object.
                $storedPath = "voice-uploads/{$reviewer->id}/{$locked->id}/{$data['client_uuid']}/source";

                $speech = $locked->speech;
                // Same defense-in-depth reasoning as the reviewer guard
                // above: speech_id is NOT NULL, but Speech is soft-deletable
                // (admin takedown), so a row going null between the lock
                // above and here is a real, if narrow, race.
                abort_if($speech === null, 409, 'This speech no longer exists.');

                $finalPath = "speeches/{$speech->ulid}/voice/".Str::uuid().'.m4a';
                $asset = $speech->assets()->create([
                    'kind' => 'voice_note', 'format' => 'm4a', 'disk' => 'media',
                    'path' => $finalPath, 'original_filename' => $audio->getClientOriginalName(),
                    'mime_type' => $audio->getMimeType(), 'byte_size' => $bytes,
                    'duration_seconds' => null, 'status' => 'processing', 'temporary_path' => $storedPath, 'temporary_byte_size' => $bytes,
                    'is_primary' => false,
                ]);

                $annotation = Annotation::query()->create([
                    'review_id' => $locked->id, 'client_uuid' => $data['client_uuid'],
                    'body' => '', 'start_seconds' => $start, 'timing_type' => 'point',
                    'duration_seconds' => 1.0, 'kind' => $data['kind'] ?? 'observation',
                    'topic' => $data['topic'] ?? null, 'audio_asset_id' => $asset->id,
                    'transcript_status' => 'pending',
                    'transcript_attempt_id' => (string) Str::uuid(),
                ]);
                $this->reviews->recordAnnotationActivity($locked);

                return [$annotation->load('audioAsset'), true, $storedPath];
            });
            if ($result[1] === true) {
                if (! Storage::disk('media')->put((string) $result[2], $contents)) {
                    throw new \RuntimeException('Unable to store voice-note upload.');
                }
                NormalizeVoiceNote::dispatch((int) $result[0]->audio_asset_id, (string) $result[2]);
            }

            return [$result[0], $result[1]];
        } catch (Throwable $e) {
            // Only this successful attempt's committed creation is ours. Never
            // find/clean up a sibling upload by deterministic path after rollback.
            if ($result !== null) {
                (new NormalizeVoiceNote((int) $result[0]->audio_asset_id, (string) $result[2]))->failed($e);
            }
            throw $e;
        }
    }
}
