<?php

namespace App\Jobs;

use App\Models\Annotation;
use App\Models\DataExport;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * STEP-11-FROZEN-CONTRACT.md §7. Two `kind`s, both delivered as a single
 * JSON file written to the private disk (never a blob-URL/client-assembled
 * export — the frontend just downloads a presigned URL for this one file):
 *
 *  - `account`: every speech this user OWNS, with every review on it,
 *    including reviewer identity (or "Former reviewer" — never a stored
 *    snapshot, same rule ReviewResource follows), PUBLISHED essay text,
 *    and PUBLISHED annotation text (§11.1's right-of-access/portability
 *    requirement: "your speeches and the commentary written about you").
 *  - `reviewer_annotations`: every review where this user IS the
 *    reviewer, scoped to speeches they don't own, with THEIR OWN
 *    annotations/essay — published AND draft, since this is the
 *    reviewer's own authored work product being handed back to them (the
 *    "download my annotations" mitigation STEP-11.md's frontend section
 *    names), not a portability grant over someone else's private draft.
 *
 * Duration is read from `speech_assets` (`kind='video', is_primary=true`)
 * — exactly how SpeechResource already does it — never from
 * `speeches.duration_seconds`, which has no writer anywhere in this
 * codebase and is always null (the frozen contract's own confirmed
 * finding).
 */
class GenerateDataExport implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public function __construct(public int $exportId)
    {
        $this->afterCommit = true;
    }

    public function handle(): void
    {
        $export = DataExport::query()->find($this->exportId);
        if ($export === null) {
            return;
        }

        $user = User::query()->find($export->user_id);
        if ($user === null) {
            $export->update(['status' => 'failed']);

            return;
        }

        try {
            $payload = $export->kind === 'account'
                ? $this->buildAccountExport($user)
                : $this->buildReviewerAnnotationsExport($user);

            $json = (string) json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            $path = "exports/{$user->id}/{$export->id}.json";

            if (! Storage::disk($export->disk)->put($path, $json)) {
                throw new \RuntimeException('Failed to write export file to storage.');
            }

            $export->update([
                'status' => 'ready',
                'path' => $path,
                'byte_size' => strlen($json),
                // Exports are not kept forever (§7) — 7 days mirrors the
                // "cooking, then ready, then gone" lifecycle the frontend
                // agent's polling-UI finding describes.
                'expires_at' => now()->addDays(7),
            ]);
        } catch (Throwable $exception) {
            report($exception);
            Log::error('data export generation failed', ['export_id' => $export->id, 'exception' => $exception->getMessage()]);
            $export->update(['status' => 'failed']);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function buildAccountExport(User $user): array
    {
        $speeches = Speech::query()->where('user_id', $user->id)
            ->with(['reviews' => fn ($q) => $q->with('reviewer'), 'primaryVideo'])
            ->get();

        // Batch-load every published annotation across every review in one
        // query, grouped by review_id — avoids one Annotation query per
        // review inside the map below, which for an account with hundreds
        // of reviews turned this job into hundreds of blocking DB round
        // trips. groupBy() on a Collection preserves each row's relative
        // order, so ordering the whole batch by start_seconds up front
        // keeps every per-review group correctly ordered without a
        // per-group re-sort.
        $reviewIds = $speeches->pluck('reviews')->flatten()->pluck('id');
        $annotationsByReview = Annotation::query()->whereIn('review_id', $reviewIds)
            ->whereNotNull('published_at')
            ->orderBy('start_seconds')
            ->get()
            ->groupBy('review_id');

        return [
            'generated_at' => now()->toIso8601String(),
            'kind' => 'account',
            'user' => ['id' => $user->id, 'username' => $user->username],
            'speeches' => $speeches->map(fn (Speech $speech) => [
                'id' => $speech->id,
                'ulid' => $speech->ulid,
                'title' => $speech->title,
                'description' => $speech->description,
                'delivered_on' => $speech->delivered_on?->toDateString(),
                'created_at' => $speech->created_at,
                'duration_seconds' => $this->primaryVideoDuration($speech),
                'reviews' => $speech->reviews->map(fn (Review $review) => [
                    'id' => $review->id,
                    'status' => $review->status,
                    // See ReviewResource's identical check for why
                    // `anonymized_at` is checked alongside null.
                    'reviewer' => ($review->reviewer === null || $review->reviewer->anonymized_at !== null)
                        ? ['display_name' => 'Former reviewer']
                        : ['id' => $review->reviewer->id, 'username' => $review->reviewer->username, 'name' => trim("{$review->reviewer->first_name} {$review->reviewer->last_name}")],
                    'essay' => $review->essay_published_at === null ? null : [
                        'html' => $review->essay_html,
                        'text' => $review->essay_text,
                        'published_at' => $review->essay_published_at,
                    ],
                    'annotations' => ($annotationsByReview->get($review->id) ?? collect())
                        ->map(fn (Annotation $annotation) => $this->annotationPayload($annotation))
                        ->values()->all(),
                ])->values()->all(),
            ])->values()->all(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function buildReviewerAnnotationsExport(User $user): array
    {
        $reviews = Review::query()->where('reviewer_id', $user->id)
            ->where('speech_owner_id', '!=', $user->id)
            ->with('speech')
            ->get();

        // Same batching as buildAccountExport, minus the published-only
        // filter — this export is the reviewer's own work product, draft
        // and published alike.
        $annotationsByReview = Annotation::query()->whereIn('review_id', $reviews->pluck('id'))
            ->orderBy('start_seconds')
            ->get()
            ->groupBy('review_id');

        return [
            'generated_at' => now()->toIso8601String(),
            'kind' => 'reviewer_annotations',
            'user' => ['id' => $user->id, 'username' => $user->username],
            'reviews' => $reviews->map(fn (Review $review) => [
                'id' => $review->id,
                'status' => $review->status,
                'speech' => $review->speech === null ? null : [
                    'id' => $review->speech->id,
                    'title' => $review->speech->title,
                ],
                'essay' => $review->essay_updated_at === null ? null : [
                    'html' => $review->essay_html,
                    'text' => $review->essay_text,
                    'published_at' => $review->essay_published_at,
                    'updated_at' => $review->essay_updated_at,
                ],
                // Own authored work, published and draft alike (see this
                // class' docblock for why that differs from `account`).
                'annotations' => ($annotationsByReview->get($review->id) ?? collect())
                    ->map(fn (Annotation $annotation) => $this->annotationPayload($annotation))
                    ->values()->all(),
            ])->values()->all(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function annotationPayload(Annotation $annotation): array
    {
        return [
            'id' => $annotation->id,
            'start_seconds' => (float) $annotation->start_seconds,
            'duration_seconds' => (float) $annotation->duration_seconds,
            'kind' => $annotation->kind,
            'topic' => $annotation->topic,
            'body' => $annotation->body,
            'published_at' => $annotation->published_at,
        ];
    }

    private function primaryVideoDuration(Speech $speech): ?float
    {
        // `primaryVideo` is eager-loaded in buildAccountExport's initial
        // query — reusing the relation (same one SpeechResource already
        // reads duration from) avoids a fresh SpeechAsset query per speech.
        $duration = $speech->primaryVideo?->duration_seconds;

        return $duration === null ? null : (float) $duration;
    }
}
