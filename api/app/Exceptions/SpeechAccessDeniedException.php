<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

/**
 * PLAN-ACCESS-DENIED-STATES.md §2. Thrown by SpeechController::show when
 * the caller holds a review row on this speech that no longer reaches it —
 * revoked, declined, or abandoned.
 *
 * Why 403 and not the 404 a stranger gets: this caller was invited, so the
 * speech's existence is not news to them, and STEP-05 §7.3's "don't confirm
 * existence" rationale simply does not apply. Returning 404 here produced an
 * indistinguishable dead end — and because the frontend had no error branch
 * at all, it rendered as a permanent `Loading…` spinner rather than any kind
 * of refusal. It also made `show()` the lone 404 among the reviewer-reachable
 * read surfaces: annotations, essay, captions, transcript, voice-notes and
 * reports already 403 this same caller (see AnnotationPolicy::readAnnotations,
 * which returns `$review->revoked_at === null` for the author). So this is a
 * consistency fix, not a new policy.
 *
 * Why one exception for all three statuses, deliberately not saying which:
 * a reviewer knows whether they declined, so splitting the statuses by code
 * would make the HTTP status itself the oracle — 403 would mean "this was
 * done to me," announcing the revocation no matter how neutral the message
 * is. One undifferentiated refusal is the more private answer, and it fixes
 * the same dead end for someone who declined and later clicked a stale link.
 *
 * Same `render()`-on-the-exception shape as CaptionsDisabledException and
 * SpeechDeletedException — Laravel calls an exception's own `render()`
 * automatically, so this needs no entry in bootstrap/app.php's
 * `withExceptions()` (which maps nothing, by design).
 *
 * `code` names the OUTCOME, not a cause. An earlier draft used
 * `review_revoked`; that was rejected because the three statuses share no
 * cause, and because the string is readable in devtools — it would have
 * contradicted the user-facing copy, which must not disclose that a
 * revocation occurred. The body must likewise never echo `revocation_reason`
 * or `revoked_at`.
 */
class SpeechAccessDeniedException extends RuntimeException
{
    public function render(Request $request): JsonResponse
    {
        return new JsonResponse([
            'message' => 'Access denied.',
            'code' => 'speech_access_denied',
        ], Response::HTTP_FORBIDDEN);
    }
}
