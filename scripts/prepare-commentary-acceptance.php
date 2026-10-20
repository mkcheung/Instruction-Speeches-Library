<?php

/** Creates a NEW local test speech with independent media copies. Never reseeds,
 * modifies, or shares deletable media paths with the existing source speech.
 * Run from the API container with COMMENTARY_APP_BASE=/var/www/html.
 */

use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\Captions\CaptionService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

$base = getenv('COMMENTARY_APP_BASE') ?: __DIR__.'/../api';
require $base.'/vendor/autoload.php';
$app = require $base.'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (! in_array(app()->environment(), ['local', 'e2e'], true)) {
    throw new RuntimeException('Only an explicitly local/e2e application may create this fixture.');
}
$member = User::query()->where('email', 'member@e2e.test')->firstOrFail();
$coach = User::query()->where('email', 'coach@e2e.test')->firstOrFail();
$source = Speech::query()->whereKey(8)->where('user_id', $member->id)->firstOrFail();
$video = $source->assets()->where('kind', 'video')->where('status', 'ready')->where('is_primary', true)->firstOrFail();
$voice = SpeechAsset::query()->where('speech_id', $source->id)->where('kind', 'voice_note')->where('status', 'ready')->firstOrFail();
$baseline = [$source->updated_at?->toISOString(), $source->reviews()->count(), $source->assets()->count()];
$newSpeech = DB::transaction(function () use ($member, $coach, $video, $voice) {
    $speech = Speech::query()->create([
        'user_id' => $member->id,
        'title' => 'Commentary playback acceptance '.now()->format('Y-m-d H:i:s'),
        'description' => 'Dedicated test copy. Synthetic written feedback and captions; independently copied real video and voice audio.',
        'captions_enabled' => true,
    ]);
    $prefix = "speeches/{$speech->ulid}/{$speech->ulid}";
    echo "New fixture target: speech {$speech->id}, {$prefix}\n";
    $copy = function (SpeechAsset $original, string $filename, bool $primary = false) use ($speech, $prefix): SpeechAsset {
        $path = "{$prefix}/{$filename}";
        if (Storage::disk($original->disk)->exists($path)) {
            throw new RuntimeException("Refusing to overwrite existing object {$path}");
        }
        if (! Storage::disk($original->disk)->copy($original->path, $path)) {
            throw new RuntimeException('Could not create an independent test media copy.');
        }

        return $speech->assets()->create([
            'kind' => $original->kind, 'format' => $original->format, 'rendition' => $original->rendition,
            'disk' => $original->disk, 'path' => $path, 'mime_type' => $original->mime_type,
            'byte_size' => $original->byte_size, 'duration_seconds' => $original->duration_seconds,
            'width' => $original->width, 'height' => $original->height,
            'status' => 'ready', 'is_primary' => $primary,
        ]);
    };
    $copy($video, 'acceptance.mp4', true);
    $audio = $copy($voice, 'voice-acceptance.m4a');
    $review = new Review;
    $review->forceFill([
        'speech_id' => $speech->id, 'reviewer_id' => $coach->id, 'speech_owner_id' => $member->id,
        'status' => 'published', 'invited_at' => now(), 'responded_at' => now(),
        'first_published_at' => now(), 'last_published_at' => now(), 'last_transition_at' => now(),
        'annotations_count' => 5, 'published_annotations_count' => 5,
    ])->save();
    foreach ([1 => 'Written overlap one', 2 => 'Written overlap two', 3 => 'Written overlap three', 30 => 'Later written feedback'] as $start => $body) {
        $note = new Annotation;
        $note->forceFill([
            'review_id' => $review->id, 'client_uuid' => (string) Str::uuid(), 'start_seconds' => $start,
            'duration_seconds' => 15, 'kind' => 'observation', 'body' => $body, 'published_at' => now(),
            'transcript_status' => 'not_applicable',
        ])->save();
    }
    $note = new Annotation;
    $note->forceFill([
        'review_id' => $review->id, 'client_uuid' => (string) Str::uuid(), 'start_seconds' => 4,
        'duration_seconds' => $audio->duration_seconds, 'kind' => 'observation',
        'body' => 'Acceptance voice transcript.', 'audio_asset_id' => $audio->id,
        'transcript_status' => 'ready', 'published_at' => now(),
    ])->save();
    app(CaptionService::class)->update($speech, "WEBVTT\n\n00:00:00.000 --> 00:01:05.000\nAcceptance speech caption.\n");
    echo "Fixture review {$review->id}; voice note {$note->id}; caption is a deliberate synthetic test cue.\n";

    return $speech;
});
$source->refresh();
if ($baseline !== [$source->updated_at?->toISOString(), $source->reviews()->count(), $source->assets()->count()]) {
    throw new RuntimeException('Source speech changed during fixture creation; investigate before testing.');
}
echo "Source speech 8 preserved. New watch URL: https://app.speechcoach.test/speeches/{$newSpeech->id}\n";
