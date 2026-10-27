<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * STEP-12-FROZEN-CONTRACT.md §5. `path` is always a randomized
 * (`Str::uuid()`) storage key — never derived from `original_filename` —
 * on the dedicated `application_documents` disk (config/filesystems.php),
 * never `media`/`media_public`.
 *
 * @property int $id
 * @property int $application_id
 * @property string $disk
 * @property string $path
 * @property string $original_filename
 * @property int $byte_size
 * @property string|null $sha256
 * @property string $status
 * @property string|null $work_claim_id
 * @property Carbon|null $work_lease_until
 * @property Carbon|null $work_next_attempt_at
 * @property Carbon|null $work_dispatched_at
 * @property int $work_attempts
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['application_id', 'disk', 'path', 'original_filename', 'byte_size', 'sha256', 'status'])]
class ApplicationDocument extends Model
{
    /**
     * Document-work protocol columns (ApplicationDocumentWork). Not
     * fillable: only the service mutates them.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'work_lease_until' => 'datetime',
            'work_next_attempt_at' => 'datetime',
            'work_dispatched_at' => 'datetime',
            'work_attempts' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<CoachApplication, $this>
     */
    public function application(): BelongsTo
    {
        return $this->belongsTo(CoachApplication::class, 'application_id');
    }
}
