<?php

namespace App\Console\Commands;

use App\Models\Annotation;
use App\Models\Review;
use Illuminate\Console\Command;
use Ramsey\Uuid\Uuid;

/**
 * STEP-06-watch-commentary.md's demo script, step 1: "fixtures at three
 * timestamps, two deliberately overlapping." Annotations have no authoring
 * UI until STEP-07 — this command IS the S6 mechanism, matching
 * GrantRoleCommand's precedent of "the command is the substitute for a UI
 * that doesn't exist yet, not a placeholder for one."
 *
 * All three fixture rows are published, matching the demo script's "pick
 * that reviewer, play, watch it work" experience end to end. The
 * draft-invisible-to-speaker acceptance criterion (a draft written after
 * publication must never reach the speaker) is proven by the feature test
 * suite directly, against rows constructed with Annotation::factory()
 * ->draft() — not by this command, since the flagship demo needs every
 * seeded row visible immediately and a demo script has no way to express
 * "and now imagine a fourth, invisible one."
 */
class SeedAnnotationsCommand extends Command
{
    protected $signature = 'annotations:seed {review : Review id to seed fixture annotations for}';

    protected $description = 'Write 3 fixture annotations (two overlapping) onto a review, per STEP-06\'s demo script.';

    public function handle(): int
    {
        $reviewId = $this->argument('review');

        $review = Review::query()->find($reviewId);

        if ($review === null) {
            $this->error("No review found with id \"{$reviewId}\".");

            return self::FAILURE;
        }

        $now = now();

        // Deterministic per-(review, slot) client_uuid, via UUIDv5, so a
        // re-run of this command is idempotent (updateOrCreate against the
        // partial unique index on (review_id, client_uuid)) rather than
        // piling up duplicate fixture rows on every invocation.
        $namespace = '3f5a4d2e-6b1a-4e3a-9c3f-1a2b3c4d5e6f';

        $fixtures = [
            [
                'start_seconds' => 14.000,
                'duration_seconds' => 6.000,
                'kind' => 'praise',
                'topic' => 'delivery',
                'body' => 'Strong opening — you made eye contact with the whole room before your first word.',
            ],
            [
                'start_seconds' => 62.000,
                'duration_seconds' => 8.000,
                'kind' => 'observation',
                'topic' => 'pacing',
                'body' => 'You picked up speed here. Worth a breath before this section next time.',
            ],
            [
                // Deliberately overlaps the row above: starts before it
                // ends (62 + 8 = 70 > 64), which is the "two overlapping
                // notes stack" moment of the demo script.
                'start_seconds' => 64.000,
                'duration_seconds' => 7.000,
                'kind' => 'correction',
                'topic' => 'structure',
                'body' => 'This is where the argument jumps — consider a signpost sentence before the pivot.',
            ],
        ];

        foreach ($fixtures as $i => $fixture) {
            $clientUuid = Uuid::uuid5($namespace, "review-{$review->id}-slot-{$i}")->toString();

            Annotation::query()->updateOrCreate(
                ['review_id' => $review->id, 'client_uuid' => $clientUuid],
                [...$fixture, 'published_at' => $now]
            );
        }

        $this->info("Seeded 3 fixture annotations onto review #{$review->id}.");

        return self::SUCCESS;
    }
}
