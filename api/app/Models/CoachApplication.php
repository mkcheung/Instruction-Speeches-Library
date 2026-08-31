<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use RuntimeException;

/**
 * STEP-12-FROZEN-CONTRACT.md §6 / MODERNIZATION_PLAN §6.8. The state
 * machine is deliberately exposed only as named transition methods below
 * — never a raw `->update(['status' => ...])` anywhere in the codebase —
 * so every legal transition is enumerated in exactly one place and an
 * illegal one throws instead of silently writing.
 *
 * States: `draft -> submitted -> under_review -> approved | rejected`,
 * and `rejected -> draft` (reapply, reusing the same row).
 * `withdrawn` is reachable from any pre-decision state.
 *
 * @property int $id
 * @property int $user_id
 * @property string $status
 * @property string|null $statement
 * @property Carbon|null $submitted_at
 * @property Carbon|null $decided_at
 * @property int|null $decided_by_id
 * @property string|null $decision_reason
 * @property Carbon|null $documents_purge_after
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['user_id', 'status', 'statement'])]
class CoachApplication extends Model
{
    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function decidedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'decided_by_id');
    }

    /**
     * @return HasMany<ApplicationDocument, $this>
     */
    public function documents(): HasMany
    {
        return $this->hasMany(ApplicationDocument::class, 'application_id');
    }

    private function assertStatus(string ...$allowed): void
    {
        if (! in_array($this->status, $allowed, true)) {
            throw new RuntimeException("CoachApplication#{$this->id}: cannot transition from status \"{$this->status}\" here.");
        }
    }

    /**
     * `draft -> submitted`, or `rejected -> draft -> submitted` in one
     * call for a reapplication (STEP-12.md: "`rejected -> draft` legal,
     * reusing the row"). Sets `submitted_at` fresh every time.
     */
    public function submit(string $statement): void
    {
        $this->assertStatus('draft', 'rejected');

        $this->forceFill([
            'status' => 'submitted',
            'statement' => $statement,
            'submitted_at' => now(),
            'decided_at' => null,
            'decided_by_id' => null,
            'decision_reason' => null,
        ])->save();
    }

    /**
     * Admin claims the application for review (`submitted -> under_review`).
     */
    public function beginReview(): void
    {
        $this->assertStatus('submitted');

        $this->forceFill(['status' => 'under_review'])->save();
    }

    /**
     * `submitted|under_review -> approved`. Does NOT itself assign the
     * `coach` role — the caller (App\Http\Controllers or a Filament
     * action) is responsible for also calling
     * `App\Services\RoleAssignmentService::assign()`, per the frozen
     * contract's "coach approval routes through assign(), never a direct
     * assignRole()" rule. `documents_purge_after` is set here (90 days
     * out, STEP-12-FROZEN-CONTRACT.md §5 / MODERNIZATION_PLAN §6.8) so the
     * retention command has a stable cutoff regardless of when it
     * actually runs.
     */
    public function approve(User $decider, ?string $reason = null): void
    {
        $this->assertStatus('submitted', 'under_review');

        $this->forceFill([
            'status' => 'approved',
            'decided_at' => now(),
            'decided_by_id' => $decider->id,
            'decision_reason' => $reason,
            'documents_purge_after' => now()->addDays(90)->toDateString(),
        ])->save();
    }

    /**
     * `submitted|under_review -> rejected`. Same 90-day purge-after
     * stamping as `approve()` — rejected applicants' documents are third-
     * party personal data too and get the same retention window.
     */
    public function reject(User $decider, ?string $reason = null): void
    {
        $this->assertStatus('submitted', 'under_review');

        $this->forceFill([
            'status' => 'rejected',
            'decided_at' => now(),
            'decided_by_id' => $decider->id,
            'decision_reason' => $reason,
            'documents_purge_after' => now()->addDays(90)->toDateString(),
        ])->save();
    }

    /**
     * The applicant withdraws before a decision is made. Legal from any
     * pre-decision state.
     */
    public function withdraw(): void
    {
        $this->assertStatus('draft', 'submitted', 'under_review');

        $this->forceFill(['status' => 'withdrawn'])->save();
    }
}
