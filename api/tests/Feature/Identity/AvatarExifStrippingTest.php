<?php

use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/**
 * EXIF stripping is a hard acceptance criterion (STEP-01-identity.md): the
 * fixture at tests/Fixtures/avatar-with-gps.jpg carries a real GPS IFD
 * (built with Pillow+piexif and confirmed readable via exif_read_data()
 * before being committed — see the file's git history/PR for how it was
 * produced). App\Services\AvatarProcessor re-encodes through Intervention
 * Image/GD rather than deleting tags, which is what actually guarantees
 * the GPS block cannot survive: GD's encoder never writes an EXIF segment
 * for output it produces from decoded pixel data.
 */
it('re-encodes an uploaded avatar and strips its GPS EXIF block', function () {
    Storage::fake('media');

    $user = User::factory()->create();

    $fixturePath = __DIR__.'/../../Fixtures/avatar-with-gps.jpg';
    expect(file_exists($fixturePath))->toBeTrue();

    // Sanity check the fixture actually carries GPS EXIF before upload,
    // so a false pass here can't be blamed on a broken fixture.
    $sourceExif = exif_read_data($fixturePath, 'ANY_TAG', true);
    expect($sourceExif)->toBeArray();
    expect($sourceExif['GPS'] ?? null)->not->toBeEmpty();

    $file = new UploadedFile($fixturePath, 'avatar-with-gps.jpg', 'image/jpeg', null, true);

    $response = $this->actingAs($user)->postJson('/api/avatar', [
        'avatar' => $file,
    ]);

    $response->assertOk();

    $storedPath = $user->fresh('profile')->profile->avatar_path;
    expect($storedPath)->not->toBeNull();
    expect(Storage::disk('media')->exists($storedPath))->toBeTrue();

    $downloaded = Storage::disk('media')->path($storedPath);
    $resultExif = @exif_read_data($downloaded, 'ANY_TAG', true);

    // GD's re-encode carries no EXIF segment at all, so exif_read_data()
    // returns false (no EXIF found) rather than an array with an empty
    // GPS section — either way, no GPS keys must be present.
    if ($resultExif !== false) {
        expect($resultExif['GPS'] ?? null)->toBeEmpty();
    } else {
        expect($resultExif)->toBeFalse();
    }
});
