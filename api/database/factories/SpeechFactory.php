<?php

namespace Database\Factories;

use App\Models\Speech;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Speech>
 */
class SpeechFactory extends Factory
{
    protected $model = Speech::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'title' => fake()->sentence(4),
            'description' => fake()->optional()->paragraph(),
            'delivered_on' => fake()->optional()->date(),
            'is_example' => false,
        ];
    }

    public function supersedes(Speech $earlier): static
    {
        return $this->state(fn (array $attributes) => [
            'user_id' => $earlier->user_id,
            'supersedes_id' => $earlier->id,
            'change_note' => fake()->sentence(),
        ]);
    }
}
