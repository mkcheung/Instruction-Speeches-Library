<?php

namespace App\Services;

use App\Exceptions\EssayConflictException;
use App\Models\Review;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * STEP-08-essay.md / the frozen STEP-08 backend contract. Mirrors
 * `AnnotationService`'s `lockForUpdate()` + optimistic-lock shape exactly,
 * against `essay_lock_version` — a column deliberately separate from
 * `annotations.lock_version` (see the migration's own comment for why).
 */
class EssayService
{
    public function __construct(private readonly EssayHtmlSanitizer $sanitizer) {}

    /**
     * `PUT /speeches/{speech}/essay`. Re-fetches `$review` under
     * `lockForUpdate()` (never trusting the instance the controller already
     * loaded) and compares its CURRENT `essay_lock_version` against the one
     * the client submitted — a mismatch throws `EssayConflictException`
     * carrying the current row, exactly like
     * `AnnotationService::update()`.
     *
     * `essay_text` (the plain-text projection) and `essay_words` are always
     * DERIVED here, on write, from the sanitized HTML — never accepted from
     * the client — so they can never drift from what `essay_html` actually
     * contains.
     */
    public function update(Review $review, User $user, string $html, int $clientLockVersion): Review
    {
        return DB::transaction(function () use ($review, $html, $clientLockVersion) {
            /** @var Review $locked */
            $locked = Review::query()->whereKey($review->id)->lockForUpdate()->firstOrFail();

            if ($locked->essay_lock_version !== $clientLockVersion) {
                throw new EssayConflictException($locked);
            }

            $sanitizedHtml = $this->sanitizer->sanitize($html);
            $text = $this->plainText($sanitizedHtml);

            $locked->essay_html = $sanitizedHtml;
            $locked->essay_text = $text;
            $locked->essay_words = $this->wordCount($text);
            $locked->essay_updated_at = now();
            $locked->essay_lock_version++;
            $locked->save();

            return $locked;
        });
    }

    /**
     * `POST /speeches/{speech}/essay/publish`. Idempotent, mirroring
     * `ReviewService::publish()`'s own idempotency guarantee: a second call
     * on an already-published essay is a no-op, not an error. Refuses (422)
     * to publish a blank essay — `ValidationException::withMessages` is the
     * same 422-from-a-service shape `QuotaService::reserve()` already uses
     * in this codebase.
     */
    public function publish(Review $review): Review
    {
        return DB::transaction(function () use ($review) {
            /** @var Review $locked */
            $locked = Review::query()->whereKey($review->id)->lockForUpdate()->firstOrFail();

            if ($locked->essay_html === null || trim($locked->essay_html) === '') {
                throw ValidationException::withMessages([
                    'essay' => ['Write something before publishing your essay.'],
                ]);
            }

            $locked->essay_published_at ??= now();
            $locked->save();

            return $locked;
        });
    }

    /**
     * The "read" half of R14's defense in depth: re-sanitizes `essay_html`
     * through the exact same allowlist before it is ever returned, so a
     * future write-time sanitizer bypass — or a row written before this
     * class existed — still can't reach a browser unsanitized. Called by
     * `EssayResource`, never bypassed by returning `$review->essay_html`
     * raw anywhere in the read path.
     */
    public function sanitizedHtmlForRead(Review $review): string
    {
        return $this->sanitizer->sanitize($review->essay_html);
    }

    /**
     * Plain-text projection of already-sanitized HTML: block-level
     * boundaries (`</p>`, `<br>`, `</li>`, `</h2>`, `</h3>`,
     * `</blockquote>`) become a single space before tags are stripped, so
     * "One.</p><p>Two." doesn't collapse into the one word "OneTwo." —
     * then whitespace is normalized to single spaces and trimmed.
     */
    private function plainText(string $sanitizedHtml): string
    {
        $withBreaks = preg_replace('/<\/(p|li|h2|h3|blockquote)>|<br\s*\/?>/i', ' ', $sanitizedHtml) ?? $sanitizedHtml;
        $stripped = strip_tags($withBreaks);
        $normalized = preg_replace('/\s+/u', ' ', $stripped) ?? $stripped;

        return trim($normalized);
    }

    /**
     * Word count of the plain-text projection (not the HTML) — Unicode-safe
     * split on whitespace rather than `str_word_count`, which is
     * locale/ASCII-sensitive.
     */
    private function wordCount(string $plainText): int
    {
        if ($plainText === '') {
            return 0;
        }

        return count(array_filter(preg_split('/\s+/u', $plainText) ?: []));
    }
}
