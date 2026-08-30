<?php

use App\Models\DataExport;
use Illuminate\Support\Facades\Storage;

it('purges a ready export past its expires_at, deleting storage before the row', function () {
    Storage::fake('media');

    $export = DataExport::factory()->ready()->create(['expires_at' => now()->subDay()]);
    Storage::disk('media')->put($export->path, '{}');

    $stillFresh = DataExport::factory()->ready()->create(['expires_at' => now()->addDays(6)]);
    Storage::disk('media')->put($stillFresh->path, '{}');

    $this->artisan('privacy:purge-expired-exports')->assertSuccessful();

    expect(DataExport::query()->find($export->id))->toBeNull();
    Storage::disk('media')->assertMissing($export->path);

    expect(DataExport::query()->find($stillFresh->id))->not->toBeNull();
    Storage::disk('media')->assertExists($stillFresh->path);
});

it('does not purge anything when nothing is old enough', function () {
    Storage::fake('media');
    $export = DataExport::factory()->ready()->create(['expires_at' => now()->addDays(7)]);
    Storage::disk('media')->put($export->path, '{}');

    $this->artisan('privacy:purge-expired-exports')->assertSuccessful();

    expect(DataExport::query()->find($export->id))->not->toBeNull();
});

it('--force-age proves the query without waiting for real expiry', function () {
    Storage::fake('media');
    // Created "now", not expired by expires_at, but --force-age treats
    // anything older than 0 seconds as purgeable — exactly STEP-11.md's
    // stub note: "a --force-age flag proves the query."
    $export = DataExport::factory()->ready()->create(['expires_at' => now()->addDays(7)]);
    Storage::disk('media')->put($export->path, '{}');

    $this->travel(1)->seconds();

    $this->artisan('privacy:purge-expired-exports', ['--force-age' => 0])->assertSuccessful();

    expect(DataExport::query()->find($export->id))->toBeNull();
});

it('leaves the row in place if the storage delete fails', function () {
    Storage::shouldReceive('disk')->with('media')->andReturnSelf();
    Storage::shouldReceive('exists')->andReturn(true);
    Storage::shouldReceive('delete')->andReturn(false);

    $export = DataExport::factory()->ready()->create(['expires_at' => now()->subDay(), 'disk' => 'media']);

    $this->artisan('privacy:purge-expired-exports')->assertSuccessful();

    expect(DataExport::query()->find($export->id))->not->toBeNull();
});
