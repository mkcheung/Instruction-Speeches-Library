<?php

use App\Models\Speech;
use App\Models\User;
use App\Services\MultipartUploadService;

/**
 * STEP-14-deploy-hardening.md ("Upload rate limiting"), R10: pins the
 * `video-upload` named limiter (AppServiceProvider) to real HTTP behavior,
 * the same style as LoginThrottleTest — asserting the actual 429, not just
 * that a config key is set, since an uncalled `->middleware('throttle:...')`
 * on the route would leave the limiter completely inert.
 */
it('throttles repeated speech-upload creation to a 429', function () {
    $user = User::factory()->create(['quota_bytes' => 10_000_000_000]);
    $speech = Speech::factory()->for($user)->create();

    $this->mock(MultipartUploadService::class, function ($mock) {
        $mock->shouldReceive('create')->andReturn('fake-upload-id');
        $mock->shouldReceive('abort');
    });

    // QuotaService::reserve caps concurrent in-flight uploads at 2
    // regardless of this limiter — abort each one immediately so the loop
    // below is exercising the `video-upload` throttle alone, not that cap.
    for ($i = 0; $i < 10; $i++) {
        $response = $this->actingAs($user)->postJson("/api/speeches/{$speech->id}/assets/uploads", [
            'original_filename' => "speech-{$i}.mp4",
            'content_type' => 'video/mp4',
            'byte_size' => 40_000_000,
        ]);
        $response->assertCreated();

        $assetId = $response->json('asset.id');
        $this->actingAs($user)->deleteJson("/api/speeches/{$speech->id}/assets/{$assetId}/uploads/fake-upload-id")
            ->assertNoContent();
    }

    $this->actingAs($user)->postJson("/api/speeches/{$speech->id}/assets/uploads", [
        'original_filename' => 'speech-11.mp4',
        'content_type' => 'video/mp4',
        'byte_size' => 40_000_000,
    ])->assertStatus(429);
});
