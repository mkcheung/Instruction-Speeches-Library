<?php

namespace Database\Factories;

use App\Models\Annotation;
use App\Models\Review;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Annotation>
 */
class AnnotationFactory extends Factory
{
    protected $model = Annotation::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'review_id' => Review::factory(),
            'client_uuid' => (string) Str::uuid(),
            'body' => fake()->sentence(),
            'start_seconds' => fake()->randomFloat(3, 0, 120),
            'duration_seconds' => 6.0,
            'timing_type' => fn (array $attributes) => ($attributes['audio_asset_id'] ?? null) !== null
                || ($attributes['transcript_status'] ?? 'not_applicable') !== 'not_applicable' ? 'point' : 'range',
            'kind' => fake()->randomElement(['praise', 'correction', 'observation']),
            'topic' => fake()->randomElement(['delivery', 'structure', 'vocal', 'body', 'content']),
            'published_at' => now(),
        ];
    }

    public function draft(): static
    {
        return $this->state(fn (array $attributes) => [
            'published_at' => null,
        ]);
    }
}
