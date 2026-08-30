<?php

namespace Database\Factories;

use App\Models\Report;
use App\Models\Speech;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Report>
 */
class ReportFactory extends Factory
{
    protected $model = Report::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'reportable_type' => Speech::class,
            'reportable_id' => Speech::factory(),
            'reporter_id' => User::factory(),
            'reason' => fake()->randomElement(Report::REASONS),
            'detail' => fake()->optional()->sentence(),
            'state' => 'open',
        ];
    }
}
