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
}
