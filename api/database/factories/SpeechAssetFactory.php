<?php

namespace Database\Factories;

use App\Models\Speech;
use App\Models\SpeechAsset;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<SpeechAsset>
 */
class SpeechAssetFactory extends Factory
{
    protected $model = SpeechAsset::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'speech_id' => Speech::factory(),
            'kind' => 'source',
            'format' => 'mp4',
            'disk' => 'media',
            'path' => 'uploads/'.Str::uuid().'/source',
            'original_filename' => 'speech.mp4',
            'mime_type' => 'video/mp4',
            'byte_size' => fake()->numberBetween(1_000_000, 40_000_000),
            'status' => 'uploading',
            'is_primary' => false,
        ];
    }

    public function video(): static
    {
        return $this->state(fn (array $attributes) => [
            'kind' => 'video',
            'format' => 'mp4',
            'path' => 'speeches/'.Str::ulid().'/video.mp4',
        ]);
    }

    public function ready(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'ready',
            'is_primary' => true,
        ]);
    }

    public function failed(string $code = 'unsupported_format'): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'failed',
            'failure_code' => $code,
            'failure_detail' => 'ffprobe: unsupported codec for remux-only pipeline',
        ]);
    }

    /**
     * §9.5: a poster frame. `is_primary` defaults false since a speech can
     * have several poster variants (srcset) but at most one primary — call
     * sites that need the primary row opt in explicitly.
     */
    public function poster(): static
    {
        return $this->state(fn (array $attributes) => [
            'kind' => 'poster',
            'format' => 'jpeg',
            'path' => 'speeches/'.Str::ulid().'/poster.jpg',
            'width' => 1280,
            'height' => 720,
        ]);
    }

    /**
     * §9.5: the hover-scrub sprite sheet — fixed 5x2 tile geometry per the
     * spec's ffmpeg call (`fps=10/DURATION,scale=160:-2,tile=5x2`).
     */
    public function sprite(): static
    {
        return $this->state(fn (array $attributes) => [
            'kind' => 'sprite',
            'format' => 'jpeg',
            'path' => 'speeches/'.Str::ulid().'/sprite.jpg',
            'width' => 800,
            'height' => 180,
        ]);
    }

    /**
     * STEP-09-captions.md: the VTT asset a caption job produces or a
     * speaker edits — `kind='captions'`/`format='vtt'` per the frozen
     * contract §8, same status enum as every other asset kind.
     */
    public function captions(): static
    {
        return $this->state(fn (array $attributes) => [
            'kind' => 'captions',
            'format' => 'vtt',
            'path' => 'speeches/'.Str::ulid().'/captions.vtt',
        ]);
    }

    public function voiceNote(): static
    {
        return $this->state(fn (array $attributes) => [
            'kind' => 'voice_note',
            'format' => 'm4a',
            'path' => 'speeches/'.Str::ulid().'/voice/'.Str::uuid().'.m4a',
            'mime_type' => 'audio/mp4',
            'is_primary' => false,
        ]);
    }
}
