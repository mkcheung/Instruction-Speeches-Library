<?php

namespace Database\Factories;

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Review>
 */
class ReviewFactory extends Factory
{
    protected $model = Review::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'speech_id' => Speech::factory(),
            'reviewer_id' => User::factory(),
            'speech_owner_id' => User::factory(),
            'invited_by_id' => null,
            'invitation_message' => fake()->optional()->sentence(),
            'allow_preview' => false,
            'prior_commentary_shared' => false,
            'status' => 'invited',
            'invited_at' => now(),
            'last_transition_at' => now(),
            // Explicitly 0, not omitted: the DB column defaults to 0
            // NOT NULL (see the migration), so a factory-built in-memory
            // instance should reflect that rather than leaving the key
            // unset — matches the same fix applied to UserFactory for
            // first_name/last_name/username.
            'annotations_count' => 0,
            'published_annotations_count' => 0,
        ];
    }

    public function accepted(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'accepted',
            'responded_at' => now(),
            'last_transition_at' => now(),
        ]);
    }

    public function declined(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'declined',
            'responded_at' => now(),
            'last_transition_at' => now(),
        ]);
    }

    public function published(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'published',
            'responded_at' => now(),
            'first_published_at' => now(),
            'last_published_at' => now(),
            'last_transition_at' => now(),
        ]);
    }

    public function revoked(): static
    {
        return $this->state(fn (array $attributes) => [
            'revoked_at' => now(),
        ]);
    }
}
