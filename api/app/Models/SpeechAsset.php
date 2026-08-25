<?php

namespace App\Models;

use Database\Factories\SpeechAssetFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Carbon;

/**
 * MODERNIZATION_PLAN §6.3, §9. One row per uploaded/derived file. `status`
 * is the only playback-readiness signal (§9.4 rule 3) — never inferred from
 * `path` existing, since a queued-but-not-yet-processed row already has one.
 *
 * `failure_detail` is admin-only (never serialized to the speaker) —
 * App\Http\Resources\SpeechAssetResource omits it deliberately; only
 * `failure_code` (a user-safe string) is exposed.
 *
 * `@property` block: same reason as Speech's — this table is also a raw
 * `DB::statement` migration, invisible to Larastan's Blueprint-AST scanner.
 *
 * @property int $id
 * @property int $speech_id
 * @property string $kind
 * @property string $format
 * @property string|null $rendition
 * @property string $disk
 * @property string $path
 * @property string|null $original_filename
 * @property string|null $mime_type
 * @property int|null $byte_size
 * @property string|null $duration_seconds
 * @property string $status
 * @property string|null $failure_code
 * @property string|null $failure_detail
 * @property bool $is_primary
 * @property string|null $upload_id
 * @property string|null $temporary_path
 * @property int|null $temporary_byte_size
 * @property string|null $purge_claim_id
 * @property int|null $purge_reviewer_id
 * @property string|null $normalization_candidate_path
 * @property int|null $client_declared_bytes
 * @property int|null $width
 * @property int|null $height
 * @property string|null $poster_time_seconds
 * @property string|null $caption_attempt_id
 * @property Carbon|null $caption_queued_at
 * @property Carbon|null $caption_started_at
 * @property Carbon|null $caption_heartbeat_at
 * @property string|null $content_revision
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'speech_id', 'kind', 'format', 'rendition', 'disk', 'path',
    'original_filename', 'mime_type', 'byte_size', 'duration_seconds',
    'status', 'failure_code', 'failure_detail', 'is_primary',
    'upload_id', 'client_declared_bytes', 'temporary_path', 'temporary_byte_size', 'purge_claim_id', 'purge_reviewer_id', 'normalization_candidate_path',
    'width', 'height', 'poster_time_seconds',
    'caption_attempt_id', 'caption_queued_at', 'caption_started_at', 'caption_heartbeat_at',
    'content_revision',
])]
class SpeechAsset extends Model
{
    /** @use HasFactory<SpeechAssetFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<Speech, $this>
     */
    public function speech(): BelongsTo
    {
        return $this->belongsTo(Speech::class);
    }

    /** @return HasOne<Annotation, $this> */
    public function voiceAnnotation(): HasOne
    {
        return $this->hasOne(Annotation::class, 'audio_asset_id');
    }

    /**
     * A voice asset can have up to three candidate storage paths at once
     * (scratch upload, ffmpeg's normalized output claimed mid-pipeline,
     * and the final path once ready) — this collects whichever of those
     * currently exist so a cleanup pass can delete them all. Was
     * hand-retyped as `array_unique(array_filter([...]))` independently
     * across six call sites (NormalizeVoiceNote, PurgeVoiceAsset,
     * PurgeDeletedVoiceAnnotation, EraseReviewerVoiceNotes,
     * FfmpegVoiceNoteProcessor, MediaReconcileCommand); a future added
     * candidate path (e.g. a waveform cache) only had to be added here
     * once instead of at each site by hand.
     *
     * @return list<string>
     */
    public static function voiceAssetCandidatePaths(?string $temporaryPath, ?string $normalizationCandidatePath = null, ?string $path = null): array
    {
        return array_values(array_unique(array_filter([$temporaryPath, $normalizationCandidatePath, $path])));
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'byte_size' => 'integer',
            'client_declared_bytes' => 'integer',
            'duration_seconds' => 'decimal:3',
            'is_primary' => 'boolean',
            'width' => 'integer',
            'height' => 'integer',
            'poster_time_seconds' => 'decimal:3',
            'caption_queued_at' => 'datetime',
            'caption_started_at' => 'datetime',
            'caption_heartbeat_at' => 'datetime',
            'temporary_byte_size' => 'integer',
            'purge_reviewer_id' => 'integer',
        ];
    }
}
