<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Intervention\Image\Drivers\Gd\Driver;
use Intervention\Image\Encoders\JpegEncoder;
use Intervention\Image\ImageManager;
use RuntimeException;

/**
 * EXIF stripping is a hard acceptance criterion (STEP-01-identity.md), and
 * the only reliable way to guarantee it is to decode the pixels and
 * RE-ENCODE a fresh raster — never to selectively delete EXIF tags from the
 * original container, which is what most "strip metadata" helpers actually
 * do and which is trivially wrong the day a new tag/IFD is invented. GD
 * (used here) never round-trips EXIF/XMP/ICC blocks on re-encode: the
 * output JPEG carries none of the input's metadata segments by
 * construction, GPS included.
 */
class AvatarProcessor
{
    private const MAX_DIMENSION = 512;

    public function __construct(private readonly ImageManager $manager = new ImageManager(new Driver)) {}

    /**
     * Re-encode the uploaded image and store it on the `media` disk,
     * returning the storage path.
     */
    public function process(UploadedFile $file, int $userId): string
    {
        // intervention/image ^4.2 renamed the v3 `read()` convenience method
        // to `decodePath()` (a package-version surprise versus what the
        // plan assumed) — `decode()`/`decodePath()`/`decodeBinary()` etc.
        // are the actual v4 API.
        $image = $this->manager->decodePath($file->getRealPath());

        $image->scaleDown(width: self::MAX_DIMENSION, height: self::MAX_DIMENSION);

        $encoded = $image->encode(new JpegEncoder(quality: 85));

        $path = sprintf('avatars/%d/%s.jpg', $userId, (string) Str::ulid());

        // The `media` disk is configured `throw => false`
        // (config/filesystems.php), so a failed PUT returns false rather
        // than raising. Discarding it let both callers persist
        // `profile.avatar_path` and answer 200 for an object that was never
        // written — a permanently broken avatar with no error, no log and
        // no retry affordance. Every other media write in the codebase
        // (CaptionService, WhisperTranscriber, VoiceNoteService,
        // FfmpegVoiceNoteProcessor) already checks its result.
        if (Storage::disk('media')->put($path, $encoded->toString()) === false) {
            throw new RuntimeException("Failed to store avatar at {$path}.");
        }

        return $path;
    }
}
