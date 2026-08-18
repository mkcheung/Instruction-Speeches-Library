<?php

namespace App\Models;

use Database\Factories\SpeechTranscriptFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * STEP-09-captions.md §6.12 / the frozen STEP-09 backend contract §7-§8.
 * One row per speech (`uq_speech_transcripts_speech_id`), always DERIVED
 * from that speech's canonical `captions` `speech_assets` VTT row — never
 * written to independently of a VTT re-derive. `source` distinguishes a
 * row nobody has touched (`whisper`) from one a speaker corrected
 * (`edited`); `model` is recorded on every row so a future model upgrade
 * can never silently invalidate a filler/pace comparison against history.
 *
 * `body_tsv` (Postgres only — see the migration) is deliberately NOT
 * listed here: it's a generated column nothing in application code ever
 * writes, and SQLite doesn't have the column at all, so giving it a
 * `@property`/cast would claim a guarantee that isn't true on every driver.
 *
 * @property int $id
 * @property int $speech_id
 * @property string $body
 * @property array<int, array{start: float, end: float, text: string}> $segments
 * @property int $word_count
 * @property float|null $words_per_minute
 * @property string $language
 * @property string $model
 * @property string $source
 * @property string|null $caption_revision
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'speech_id', 'body', 'segments', 'word_count', 'words_per_minute',
    'language', 'model', 'source', 'caption_revision',
])]
class SpeechTranscript extends Model
{
    /** @use HasFactory<SpeechTranscriptFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<Speech, $this>
     */
    public function speech(): BelongsTo
    {
        return $this->belongsTo(Speech::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'segments' => 'array',
            'word_count' => 'integer',
            'words_per_minute' => 'float',
        ];
    }
}
