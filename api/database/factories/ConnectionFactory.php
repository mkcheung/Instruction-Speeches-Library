<?php

namespace Database\Factories;

use App\Models\Connection;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Direct-row factory for tests that need a `connections` row without going
 * through App\Services\ConnectionService's mirrored-write dance (e.g.
 * fixture setup for the rail/timeline query tests). Anything asserting the
 * mirrored-pair invariant itself must go through the service, not this
 * factory.
 *
 * @extends Factory<Connection>
 */
class ConnectionFactory extends Factory
{
    protected $model = Connection::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'owner_id' => User::factory(),
            'peer_id' => User::factory(),
            'state' => 'pending',
            'initiated_by_id' => null,
            'blocked_by_id' => null,
            'requested_at' => now(),
            'responded_at' => null,
            'connected_at' => null,
            'note' => null,
        ];
    }

    public function accepted(): static
    {
        return $this->state(fn (array $attributes) => [
            'state' => 'accepted',
            'responded_at' => now(),
            'connected_at' => now(),
        ]);
    }

    public function declined(): static
    {
        return $this->state(fn (array $attributes) => [
            'state' => 'declined',
            'responded_at' => now(),
        ]);
    }

    public function blocked(): static
    {
        return $this->state(fn (array $attributes) => [
            'state' => 'blocked',
            'responded_at' => now(),
        ]);
    }
}
