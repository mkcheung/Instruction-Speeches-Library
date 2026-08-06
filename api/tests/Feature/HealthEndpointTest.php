<?php

use Illuminate\Testing\Fluent\AssertableJson;

test('GET /api/health responds ok with a timestamp', function () {
    $response = $this->getJson('/api/health');

    $response
        ->assertOk()
        ->assertJson(fn (AssertableJson $json) => $json
            ->where('status', 'ok')
            ->has('timestamp')
        );
});

test('GET /api/health allows the configured frontend origin with credentials', function () {
    $response = $this->withHeaders([
        'Origin' => config('cors.allowed_origins')[0],
    ])->getJson('/api/health');

    $response
        ->assertOk()
        ->assertHeader('Access-Control-Allow-Credentials', 'true')
        ->assertHeader('Access-Control-Allow-Origin', config('cors.allowed_origins')[0]);
});
