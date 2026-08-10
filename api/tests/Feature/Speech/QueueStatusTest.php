<?php

use App\Models\User;
use Illuminate\Redis\Connections\Connection;
use Illuminate\Support\Facades\Redis;

/**
 * STEP-04-every-video-plays.md §9.5's backpressure gauge
 * (App\Http\Controllers\Api\QueueStatusController): the depth of the
 * `transcode` queue on the `redis-long` connection, read as
 * `Redis::connection()->llen('queues:transcode')`.
 *
 * CI's Pest job (.github/workflows/ci.yml `test`) runs against bare sqlite
 * with no Redis service container — only the docker-compose-backed `e2e`
 * job has a real Valkey instance — so this mocks the `Redis` facade the
 * same way PlaybackAuthorizationTest/PresignEndpointTest mock `Storage`,
 * rather than depending on a live connection.
 */
it('returns the queue depth reported by Redis', function () {
    $user = User::factory()->create();

    $connection = Mockery::mock(Connection::class);
    $connection->shouldReceive('llen')->once()->with('queues:transcode')->andReturn(0);
    Redis::shouldReceive('connection')->once()->andReturn($connection);

    $response = $this->actingAs($user)->getJson('/api/queue/transcode-depth');

    $response->assertOk();
    $response->assertExactJson(['depth' => 0]);
});

it('reflects a non-zero depth as a plain integer', function () {
    $user = User::factory()->create();

    $connection = Mockery::mock(Connection::class);
    $connection->shouldReceive('llen')->once()->with('queues:transcode')->andReturn(3);
    Redis::shouldReceive('connection')->once()->andReturn($connection);

    $response = $this->actingAs($user)->getJson('/api/queue/transcode-depth');

    $response->assertOk();
    $response->assertExactJson(['depth' => 3]);
});
