<?php

namespace App\Models;

use App\Services\ApplicationDocumentWork;
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
    /** `original_filename` once account erasure has shredded the row (§9). */
    public const ERASED_FILENAME = '[erased]';

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

    /**
     * The one "downloadable" rule (PLAN-COACH-APPLICATION-REVIEW-PAGE.md
     * §5.3): the review page, the download controller and the decision
     * guard all call this. Purged and erased rows keep `status = 'clean'`
     * with `path = ''`, hence the path check.
     */
    public function isDownloadable(): bool
    {
        return $this->status === 'clean' && $this->path !== '';
    }

    /**
     * The review page's state badge (§2.5 table). "Scan failed" mirrors
     * `ApplicationDocumentWork::resetExhausted()`: `claim()` writes the final
     * attempt at its start, so attempts alone would misreport a scan still
     * in flight under a live lease.
     */
    public function displayState(): string
    {
        return match (true) {
            // Both conditions: original_filename is client-supplied, so a clean
            // upload literally named "[erased]" must not read as erased.
            $this->path === '' && $this->original_filename === self::ERASED_FILENAME => 'Erased',
            $this->status === 'infected' => 'Quarantined',
            $this->path === '' => 'Purged',
            $this->status === 'clean' => 'Clean',
            $this->work_attempts >= ApplicationDocumentWork::MAX_STARTS
                && ! ($this->work_lease_until?->isFuture() ?? false) => 'Scan failed',
            default => 'Scanning',
        };
    }
}
