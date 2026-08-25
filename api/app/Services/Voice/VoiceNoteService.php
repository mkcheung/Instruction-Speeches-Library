<?php

namespace App\Services\Voice;

use App\Exceptions\AnnotationCapExceededException;
use App\Jobs\NormalizeVoiceNote;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\QuotaService;
use App\Services\ReviewService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

class VoiceNoteService
{
    public function __construct(private readonly ReviewService $reviews, private readonly QuotaService $quota) {}

    /** @return array{0: Annotation, 1: bool} */
    public function create(Review $review, UploadedFile $audio, array $data): array
    {
        $storedPath = null;
        $contents = $audio->getContent();

        try {
            $result = DB::transaction(function () use ($review, $audio, $data, &$storedPath): array {
                // Global voice-write lock order is identity -> review ->
                // asset/annotation. EraseSelfAccount uses the same order,
                // preventing a PostgreSQL create-vs-erasure deadlock.
                User::query()->whereKey($review->reviewer_id)->lockForUpdate()->firstOrFail();
                $locked = Review::query()->with(['reviewer', 'speech'])->whereKey($review->id)->lockForUpdate()->firstOrFail();
                abort_if($locked->voice_erasure_started_at !== null || $locked->reviewer?->erasure_started_at !== null, 409, 'Account erasure is in progress.');
                $existing = Annotation::query()->with('audioAsset')
                    ->where('review_id', $locked->id)->where('client_uuid', $data['client_uuid'])->first();
                if ($existing !== null) {
                    return [$existing, false];
                }
                if ($locked->annotations_count >= 200) {
                    throw new AnnotationCapExceededException;
                }

                $bytes = (int) $audio->getSize();
                $reviewer = $locked->reviewer;
                $this->quota->reserveDirect($reviewer, $bytes);

                // The object is written only after this transaction commits.
                // Therefore every stored input always has a durable asset-row
                // ledger; a hard kill before commit cannot orphan an object.
                $storedPath = "voice-uploads/{$reviewer->id}/{$locked->id}/{$data['client_uuid']}/source";

                $finalPath = "speeches/{$locked->speech->ulid}/voice/".Str::uuid().'.m4a';
                $asset = $locked->speech->assets()->create([
                    'kind' => 'voice_note', 'format' => 'm4a', 'disk' => 'media',
                    'path' => $finalPath, 'original_filename' => $audio->getClientOriginalName(),
                    'mime_type' => $audio->getMimeType(), 'byte_size' => $bytes,
                    'duration_seconds' => null, 'status' => 'processing', 'temporary_path' => $storedPath, 'temporary_byte_size' => $bytes,
                    'is_primary' => false,
                ]);

                $annotation = Annotation::query()->create([
                    'review_id' => $locked->id, 'client_uuid' => $data['client_uuid'],
                    'body' => '', 'start_seconds' => $data['start_seconds'],
                    'duration_seconds' => 1.0, 'kind' => $data['kind'] ?? 'observation',
                    'topic' => $data['topic'] ?? null, 'audio_asset_id' => $asset->id,
                    'transcript_status' => 'pending',
                    'transcript_attempt_id' => (string) Str::uuid(),
                ]);
                $this->reviews->recordAnnotationActivity($locked);

                return [$annotation->load('audioAsset'), true];
            });
            if ($result[1] === true) {
                if (! Storage::disk('media')->put((string) $storedPath, $contents)) {
                    throw new \RuntimeException('Unable to store voice-note upload.');
                }
                NormalizeVoiceNote::dispatch((int) $result[0]->audio_asset_id, (string) $storedPath);
            }

            return $result;
        } catch (Throwable $e) {
            if ($storedPath !== null) {
                // An after-commit queue dispatch can throw after the rows and
                // quota reservation are already durable. In that case the
                // normal job backstop owns the exact same CAS/accounting and
                // object cleanup as a worker-side failure. Only a genuinely
                // rolled-back transaction has no asset row and may delete the
                // object directly without touching quota a second time.
                $committedAsset = SpeechAsset::query()->where('temporary_path', $storedPath)->first();
                if ($committedAsset !== null) {
                    (new NormalizeVoiceNote($committedAsset->id, $storedPath))->failed($e);
                } else {
                    Storage::disk('media')->delete($storedPath);
                }
            }
            throw $e;
        }
    }
}
