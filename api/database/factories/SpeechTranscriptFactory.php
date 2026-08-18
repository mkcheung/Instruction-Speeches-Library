<?php

namespace Database\Factories;

use App\Models\Speech;
use App\Models\SpeechTranscript;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SpeechTranscript>
 */
class SpeechTranscriptFactory extends Factory
{
    protected $model = SpeechTranscript::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $body = fake()->paragraph(6);
        $wordCount = str_word_count($body);

        return [
            'speech_id' => Speech::factory(),
            'body' => $body,
            'segments' => [
                ['start' => 0.0, 'end' => 2.0, 'text' => 'This is a fake transcript.'],
                ['start' => 2.0, 'end' => 4.0, 'text' => 'Good enough for tests.'],
            ],
            'word_count' => $wordCount,
            'words_per_minute' => 130.0,
            'language' => 'en',
            'model' => 'whisper.cpp-base.en',
            'source' => 'whisper',
        ];
    }

    public function edited(): static
    {
        return $this->state(fn (array $attributes) => ['source' => 'edited']);
    }
}
