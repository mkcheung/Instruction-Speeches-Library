<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    /**
     * The current password being used by the factory.
     */
    protected static ?string $password;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            // Explicitly null, not omitted: STEP-07 turned on
            // Model::preventAccessingMissingAttributes(), which
            // distinguishes "column exists and is NULL" from "this key was
            // never even set on the in-memory model" — a plain DB row has
            // the former for these three (nullable until onboarding step 1,
            // per the identity-columns migration's own comment), so a
            // factory-built instance must match that rather than omitting
            // the keys and only coincidentally working before this guard
            // existed.
            'first_name' => null,
            'last_name' => null,
            'username' => null,
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password' => static::$password ??= Hash::make('password'),
            'remember_token' => Str::random(10),
        ];
    }

    /**
     * Indicate that the model's email address should be unverified.
     */
    public function unverified(): static
    {
        return $this->state(fn (array $attributes) => [
            'email_verified_at' => null,
        ]);
    }
}
