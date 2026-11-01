<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
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
 * States: `draft -> submitted -> under_review -> approved | rejected`.
 * `withdrawn` is reachable from any pre-decision state. Reapplying after
 * `rejected` or `withdrawn` creates a NEW draft row; the decided row keeps
 * its decision, documents and retention clock. This deliberately replaces
 * STEP-12's "`rejected -> draft`, reusing the row"
 * (PLAN-COACH-APPLICATION-REVIEW-PAGE.md §8).
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
 *
 * STEP-14-deploy-hardening.md phpstan level 8: `user_id` is `NOT NULL`
 * (every application belongs to exactly one applicant), but Larastan
 * infers `BelongsTo` as nullable generically from the relation method's
 * return type alone. `decidedBy` is NOT overridden — `decided_by_id` is
 * genuinely nullable until a decision is made.
 * @property-read User $user
 */
#[Fillable(['user_id', 'status', 'statement'])]
class CoachApplication extends Model
{
    /** Still awaiting a decision: the admin queue and dashboard tile. */
    public const UNDECIDED_STATUSES = ['submitted', 'under_review'];

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

    /**
     * PLAN-COACH-APPLICATION-REVIEW-PAGE.md §5.3. The review page's nested
     * Download action resolves its row by list position, and an unordered
     * relation can reorder on Postgres after an UPDATE; ids only ever grow.
     * Kept off `documents()`, whose `count()` would reject an ORDER BY.
     *
     * @return HasMany<ApplicationDocument, $this>
     */
    public function documentsForReview(): HasMany
    {
        return $this->documents()->orderBy('id');
    }

    /**
     * Q3 (PLAN-COACH-APPLICATION-REVIEW-PAGE.md §7): approval needs at least
     * one downloadable document. The one copy of that rule, read by both the
     * decision service's 409 guard and the review page's disabled Approve.
     * At most two rows (`CoachApplicationSubmissionService::MAX_DOCUMENTS`).
     */
    public function hasDownloadableDocument(): bool
    {
        return $this->documentsForReview->contains->isDownloadable();
    }

    private function assertStatus(string ...$allowed): void
    {
        if (! in_array($this->status, $allowed, true)) {
            throw new RuntimeException("CoachApplication#{$this->id}: cannot transition from status \"{$this->status}\" here.");
        }
    }

    /**
     * `draft -> submitted` only. A reapplication is a fresh draft row
     * (PLAN-COACH-APPLICATION-REVIEW-PAGE.md §8), so a submitted row never
     * carries an earlier decision to clear.
     */
    public function submit(string $statement): void
    {
        $this->assertStatus('draft');

        $this->forceFill([
            'status' => 'submitted',
            'statement' => $statement,
            'submitted_at' => now(),
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

    /**
     * The next application in the decision queue
     * (PLAN-COACH-APPLICATION-DECISION-PANEL.md phase 2): the first
     * undecided row strictly after this one by `submitted_at, id`, else a
     * wrap to the first undecided overall, else null when this is the only
     * one. Ignores the admin list's filters on purpose.
     */
    public function nextUndecided(): ?self
    {
        // A null `submitted_at` (withdrawn while still a draft) must never
        // reach `where('submitted_at', '>', null)`: Laravel throws on Postgres.
        if ($this->submitted_at !== null) {
            $after = $this->undecidedQueue()
                ->where(fn ($q) => $q
                    ->where('submitted_at', '>', $this->submitted_at)
                    ->orWhere(fn ($q) => $q->where('submitted_at', $this->submitted_at)->where('id', '>', $this->getKey())))
                ->first();

            if ($after !== null) {
                return $after;
            }
        }

        return $this->undecidedQueue()->first();
    }

    /**
     * Mirror image of {@see nextUndecided()}: the last undecided row
     * strictly before this one, else a wrap to the last undecided overall.
     */
    public function previousUndecided(): ?self
    {
        // Null `submitted_at`: skip the comparison, see nextUndecided().
        if ($this->submitted_at !== null) {
            $before = $this->undecidedQueue(descending: true)
                ->where(fn ($q) => $q
                    ->where('submitted_at', '<', $this->submitted_at)
                    ->orWhere(fn ($q) => $q->where('submitted_at', $this->submitted_at)->where('id', '<', $this->getKey())))
                ->first();

            if ($before !== null) {
                return $before;
            }
        }

        return $this->undecidedQueue(descending: true)->first();
    }

    /**
     * The decision queue minus this application, in the list's order
     * (`submitted_at, id`), or its exact reverse. Every undecided row has a
     * `submitted_at` (`submit()` sets it), though no constraint enforces
     * that: a NULL would sort last on Postgres ascending and first
     * descending, and first on SQLite ascending.
     *
     * @return Builder<self>
     */
    private function undecidedQueue(bool $descending = false): Builder
    {
        $direction = $descending ? 'desc' : 'asc';

        return self::query()
            ->whereIn('status', self::UNDECIDED_STATUSES)
            ->whereKeyNot($this->getKey())
            ->orderBy('submitted_at', $direction)
            ->orderBy('id', $direction);
    }
}
