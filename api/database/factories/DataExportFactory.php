<?php

namespace Database\Factories;

use App\Models\DataExport;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DataExport>
 */
class DataExportFactory extends Factory
{
    protected $model = DataExport::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'kind' => 'account',
            'status' => 'processing',
            'disk' => 'media',
        ];
    }

    public function ready(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'ready',
            'path' => 'exports/'.fake()->uuid().'.json',
            'byte_size' => fake()->numberBetween(200, 5000),
            'expires_at' => now()->addDays(7),
        ]);
    }
}
