# PLAN — Honest access-denied states on `GET /api/speeches/{id}`

**Status:** IMPLEMENTED under Option A (see §1), 2026-10-05. Verified: full
backend suite 476 passed / 2 skipped; frontend 325 passed across 62 files;
`tsc -b`, `eslint`, `pint` and `phpstan` all clean; and all four access tiers
confirmed live against the running stack. Deviations from this plan as written
are recorded in §9.
**Date:** 2026-10-05
**Branch:** `development` (last commit `4f7dd12`)

Produced from three parallel layer reviews (backend / frontend / data), each
briefed to verify against real code and to flag what it could not confirm.
Every load-bearing claim below was then independently spot-checked against the
repo and the live Postgres container before being written down. Claims that are
**code-read only** are labelled as such — they are not presented as verified
behaviour.

---

## 0. Three corrections to the premise this work started from

The original framing was wrong in three ways. Each correction changes the
design, so they come first.

### 0.1 The visible symptom is not a 404 — it is an infinite spinner

The premise was "both cases return 404, let's distinguish them." In fact the
user never sees a 404 at all.

`web/src/routes/SpeechWatch.tsx:80` destructures only `{ data: speech, isLoading }`
— `isError`/`error` are never read anywhere in the file. The sole early return
at `:209` is:

```ts
if (isLoading || !speech) {
  return <div className="…">Loading…</div>
}
```

On any failure RTK Query settles to `isLoading: false, isError: true,
data: undefined`, so `!speech` still holds and the page renders **`Loading…`
forever**. Traced end to end: `web/src/lib/baseQuery.ts:60-67` dispatches
`auth:unauthenticated` on **401 only**, so nothing pre-empts a 403 or 404;
there is no `errorElement` on any route in `web/src/App.tsx` and no error
boundary anywhere in `web/src` (zero hits for `errorElement|ErrorBoundary|componentDidCatch`).
The dependent hooks stay quiet (`useCaptionsJob` is gated on
`asset?.status === 'ready'`, `useMyReviewForSpeech` on `!isOwner && !!speech`),
so there is no request storm either — it hangs silently, with no redirect and
no console error.

**There is a second, independent path into the same hang** that was not in the
original framing: `speechId = Number(id)` at `:79` with `skip: !speechId`. For
`/speeches/abc` → `NaN` and `/speeches/0` → `0`, both falsy, the query is
skipped, so `isLoading` is false and `data` undefined — identical permanent
spinner. The fix must branch on "no valid id" too, not only on query error.

**Consequence:** the headline deliverable is a bug fix, not a privacy feature.
Even if the backend never changed, rendering *anything* instead of a spinner is
the larger share of the user-visible win.

### 0.2 Changing `show()` to 403 *removes* inconsistency — it does not create it

The original worry was that a 403 on `show()` would create a contract seam with
other endpoints still returning 404. The opposite is true. **`show()` is the
lone 404 among the reviewer-reachable read surfaces; every other endpoint a
revoked reviewer can reach already returns 403.**

Verified first-hand: `api/app/Policies/AnnotationPolicy.php:32-34` returns
`$review->revoked_at === null` for the author, and
`api/tests/Feature/Annotation/AnnotationEndpointTest.php:61-84` is an existing
test that sets `revoked_at` and asserts `assertForbidden()`. The same 403
pattern holds for essay, captions, transcript, voice-notes, voice-preferences
and reports.

| Endpoint | Revoked reviewer **today** | After this change |
|---|---|---|
| `GET /speeches/{s}` | **404** | **403** |
| `GET /speeches/{s}/annotations` | 403 | unchanged |
| `POST/PATCH/DELETE annotations` | 403 | unchanged |
| `GET/PUT /speeches/{s}/essay` | 403 | unchanged |
| `GET /speeches/{s}/captions` | 403 | unchanged |
| `GET /speeches/{s}/transcript` | 403 | unchanged |
| `POST /speeches/{s}/voice-notes` | 403 | unchanged |
| `POST /reports` (speech target) | 403 | unchanged |
| `GET .../assets/{a}/playback-url` | 404 | **see §6.1 — decision needed** |
| `GET .../voice-playback-url` | 404 (deliberate) | leave 404 |

*(This table is the backend reviewer's trace through gate code. The rows
carrying a cited test are corroborated by an existing assertion; the
voice-preference and `restore` rows are **code-read only and untested** — see
§8.)*

Also relevant and verified first-hand: `api/app/Http/Controllers/Api/ReportController.php:41,47`
already does `abort_unless(Gate allows 'view', 403)`. So the codebase is
**already** inconsistent on this exact question, in the direction this plan
proposes.

### 0.3 The no-"revoked" copy constraint is already violated elsewhere

> *"Please do not state access was revoked. Denied should suffice."*

This cannot be satisfied by changing the speech page alone. The reviewer's own
dashboard already tells them the whole story, one click away:

- `web/src/routes/Dashboard.tsx:63` — a section headed **"Revoked"**, empty text **"Nothing revoked."**
- `:65` — timestamp label **"Revoked {date}"**
- `:116` — a red `destructive` `<Badge>` reading **"Revoked"**
- `:129` — **`Reason: {review.revocation_reason}`**, the speaker's free text verbatim

Fed deliberately by the backend: `api/app/Http/Controllers/Api/ReviewController.php:173-182`
has a dedicated `revoked` section selecting those rows *for the reviewer
themselves*, and `api/app/Http/Resources/ReviewResource.php:35-36` serializes
`revoked_at` and `revocation_reason` **unconditionally** — no `when()`, no
viewer gate. `web/src/hooks/useMyReviewForSpeech.ts:30` already folds the
`revoked` array into its search set.

`ReviewService.php:260-262`'s own docblock says `revocation_reason` "is shown
to the reviewer" — so this is a deliberate product decision from STEP-05, now
in direct conflict with the new constraint.

**This is the one open decision in this plan. See §1.**

---

## 1. DECISION REQUIRED — scope of the no-disclosure rule

Both the frontend and data reviewers independently flagged this. It must be
answered before implementation, because it changes the size of the work by
roughly a factor of three.

### Option A — page-level (recommended)

Treat the constraint as governing **the denial surface**: the page shown to
someone who has been cut off says "Access denied" and nothing more. The
reviewer's own dashboard continues to disclose the revocation and its reason,
as designed in STEP-05.

- **Rationale:** a coach whose access was withdrawn arguably *should* be told
  on their own dashboard — that is their work and their record. What they
  should not get is an unexplained dead end when they follow a stale link.
- **Scope:** §2 + §3 + §4 as written. 3 files changed, 2 test files added.
- **Risk:** the constraint is only honoured on one surface. Anyone auditing for
  non-disclosure will find the dashboard immediately.

### Option B — global non-disclosure

Suppress revocation language everywhere the reviewer can see it.

- **Additional work beyond Option A:**
  - Rename the dashboard section, badge and timestamp label (4 strings in `Dashboard.tsx`).
  - Remove `Reason: {revocation_reason}` from `ReviewCard`.
  - Gate `revocation_reason`/`revoked_at` out of `ReviewResource` **for the
    reviewer-facing caller only** — the resource is shared with the
    owner-facing `forSpeech` caller, so the speaker who wrote the reason must
    keep seeing it. That means a conditional field, not a deletion.
  - Revisit whether a `revoked` dashboard section should exist at all; if it
    does, under what neutral name, and what it says instead of a reason.
- **Scope:** adds ~2 files and a product-copy decision on the dashboard.
- **Risk:** actively removes information from the coach about their own work.
  This reverses a deliberate STEP-05 decision and should be an explicit product
  call, not a side effect of a bug fix.

### Option C — zero-backend-change alternative (documented for completeness)

Because `useMyReviewForSpeech` already holds the revoked row client-side, the
graceful page is achievable **with no backend change at all**: branch on
`data.revoked` while `show()` keeps its 404.

- **Pro:** strictly less disclosive than a 403.
- **Con:** the access decision becomes client-side rather than
  server-authoritative; it depends on the `GET /reviews` round trip having
  landed; and it leaves `show()` permanently inconsistent with the seven
  endpoints that already 403 (§0.2).
- **Not recommended** — but the 403 should be understood as a consistency and
  server-authority argument, not a capability one. Option C proves the
  capability already exists.

**Everything below assumes Option A.** Option B's extra work is additive and
does not invalidate any of it.

---

## 2. Backend change

### 2.1 Lump `revoked` + `declined` + `abandoned` into one undifferentiated 403

This is the single most important design point, and it is what actually
delivers the copy constraint.

The three statuses are distinguishable in code, so they *could* be split. **They
must not be.** If `declined` → 404 and `revoked` → 403, then the status code
itself announces the revocation: a reviewer knows whether they declined, so a
403 tells them "this was done to me," no matter how neutral the response body
is. The HTTP status becomes the oracle that the copy was written to avoid.

One undifferentiated `Access denied.` across all three is therefore **more**
privacy-preserving, not less — and it fixes the identical dead end for a
reviewer who declined and later clicked a stale link.

### 2.2 The query — one lookup, no ordering

Verified first-hand: `uq_reviews_speech_reviewer UNIQUE btree (speech_id, reviewer_id)`
exists on the live database, and `ck_reviews_status` permits exactly
`invited, declined, accepted, in_progress, published, abandoned` — **there is no
`revoked` status**; revocation is orthogonal, carried by `revoked_at` alone.

Verified first-hand: `api/app/Services/ReviewService.php:105-119` — re-inviting
a revoked reviewer **clears the tombstone in place** (`revoked_at`,
`revoked_by_id`, `revocation_reason` → `null`, `status` → `'invited'`) on the
existing row. Pinned by `api/tests/Feature/Review/ReviewServiceTest.php:147-173`,
which asserts the same row id and `count() === 1`.

**Therefore at most one row exists per (speech, reviewer), and the shadowing
risk originally worried about does not exist.** No second query, no `latest()`,
no `orderByRaw`. Just drop the filter and branch in PHP:

```php
// api/app/Http/Controllers/Api/SpeechController.php, replacing :64-77

$review = $isOwner ? null : Review::query()
    ->where('speech_id', $speech->id)
    ->where('reviewer_id', $user->id)
    // No `whereNull('revoked_at')`: uq_reviews_speech_reviewer guarantees at
    // most one row per (speech, reviewer), and ReviewService::invite clears
    // the tombstone in place on re-invite rather than inserting a second row
    // — so this cannot shadow a live grant, and keeping the revoked row
    // visible is what lets the denied tier below be honest instead of a dead
    // end.
    ->first();

$isLive = $review !== null && $review->revoked_at === null;
$isGranting = $isLive && in_array($review->status, Review::ACCESS_GRANTING, true);

// Never held a review here at all (or it was revoke-and-purged) — don't
// confirm existence to a stranger. Unchanged from STEP-05 §7.3.
if (! $isOwner && $review === null) {
    return new JsonResponse(['message' => 'No such speech.'], Response::HTTP_NOT_FOUND);
}

// Held a review that no longer reaches the speech: revoked, declined or
// abandoned. 403, not 404 — this caller was invited, so existence is not news
// to them, and a 404 here is an indistinguishable dead end. Deliberately does
// not say WHICH of the three it is (see §2.1).
if (! $isOwner && ! $isGranting && ! ($isLive && $review->status === 'invited')) {
    throw new SpeechAccessDeniedException;
}
```

**Do not** implement this by delegating to `authorize('view', $speech)`.
`SpeechPolicy::view` returns `true` for `invited`, so it cannot express the
reduced tier, and it collapses revoked/declined/abandoned into one bit with no
row left to branch on.

**Do not** touch `Speech::scopeVisibleTo` — `api/tests/Feature/Speech/VisibleToSnapshotTest.php:21-27`
is a byte-exact SQL snapshot test. The change above does not touch it.

### 2.3 New exception, matching the established idiom

Verified first-hand: `api/bootstrap/app.php` contains **no** exception-to-status
mapping — only `shouldRenderJsonWhen(wantsJson())`. The convention is
self-rendering exceptions; there are 9 in `api/app/Exceptions/`.
`CaptionsDisabledException.php` is the closest precedent, and its docblock
explicitly documents the `code` convention: *"a stable machine-readable string
… so the frontend can branch on it without string-matching `message`."*

```php
// api/app/Exceptions/SpeechAccessDeniedException.php
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
```

**No `bootstrap/app.php` edit needed** — Laravel calls an exception's own
`render()` automatically.

**On the code string:** the originally proposed `review_revoked` is rejected. It
names a cause the three statuses do not share, and it contradicts the UI copy
in a field any reviewer can read in devtools. `speech_access_denied` names the
outcome, covers all three statuses, and matches the snake_case
`{resource}_{state}` shape of `captions_disabled` and the
`speech_assets.failure_code` family.

The 403 body must not echo `revocation_reason` or `revoked_at`.

### 2.4 No migration

Verified first-hand. Every column read (`speech_id`, `reviewer_id`,
`revoked_at`) exists and is correctly typed. Two existing indexes serve the
lookup — `uq_reviews_speech_reviewer` (leading `speech_id`) and
`reviews_reviewer_speech_index` (leading `reviewer_id`); `EXPLAIN` with
`enable_seqscan=off` confirms an index scan is available. (The live table is 5
rows in 1 page, so the planner currently picks a seq scan — that is correct
behaviour at this size, not a missing index.)

Note the two indexes added by `add_timeline_indexes_to_reviews_table`
(`ix_reviews_timeline`, `ix_reviews_incoming`) are **partial on
`revoked_at IS NULL`** and so cannot serve this query — they exclude exactly
the rows of interest. Irrelevant, not a gap.

**Do not** add a `'revoked'` value to `ck_reviews_status`. Revocation is
deliberately orthogonal to status, and the migration would need driver-branching
for the SQLite test suite.

---

## 3. Frontend change — `SpeechWatch.tsx`

### 3.1 Reuse the existing pattern; do not invent one

The pattern to copy is `web/src/routes/ReviewerDirectory.tsx:52-80`, verified
first-hand. It solves the identical problem and its comment already states the
governing principle:

> *"'the request failed' and 'nobody matched' are different facts"*

Its convention, which this change must follow:

- **permission / empty states** → `text-muted-foreground`, **no** `role="alert"`
- **genuine failures** → `role="alert"` + `text-destructive`

An access denial is the former, not the latter.

**Do not reuse `<NotFound />`.** Verified first-hand: `web/src/routes/NotFound.tsx:3`
renders `<main className="… min-h-svh …">`, and `web/src/components/layout/AppLayout.tsx:40`
already renders `<main id="content">`. `/speeches/:id` is inside `AppLayout`
(`App.tsx:121`), so returning `NotFound` there nests `<main>` inside `<main>`
and forces a `min-h-svh` block into a flex column with a definite height.
(`PublicProfile.tsx:58` can return it safely only because `/u/:username` sits
outside `AppLayout`.)

There is no generic `EmptyState`/`ErrorState` in `components/ui/` — the
`ReviewerDirectory` `<Card><CardContent>` block is the idiom.

### 3.2 Ordered branches

Destructure `isError, error` at `:80` and replace the single guard at `:209`
with five ordered branches, each wrapped in SpeechWatch's own
`mx-auto flex max-w-3xl flex-col gap-4 px-4 py-10` container so it sits
correctly inside `AppLayout`'s `<main>`:

| # | Condition | Render |
|---|---|---|
| 1 | `!speechId` (covers `NaN`, `0` — §0.1) | not-found card |
| 2 | `isLoading` | existing `Loading…` div, unchanged |
| 3 | `getErrorStatus(error) === 403` | access-denied card, `text-muted-foreground` |
| 4 | `getErrorStatus(error) === 404` | not-found card, `text-muted-foreground` |
| 5 | `isError \|\| !speech` | failure card, `role="alert"` + `text-destructive` |

Branch 5 is the catch-all that closes the hang permanently — including the case
where `getErrorStatus` returns `undefined` on a network error (it reads
`error.status`, which a `SerializedError` does not carry).

`getErrorStatus` already exists at `web/src/lib/errorStatus.ts:4` and is used
this way at `ReviewerDirectory.tsx:52`, `BecomeACoach.tsx:25`, `AuthShell.tsx:15`.

### 3.3 Copy

All strings avoid "revoked" and avoid implying a state change.

| Where | String |
|---|---|
| 403 heading | `Access denied` |
| 403 body | `This speech isn't available to your account.` |
| 404 | `No such speech.` — matches the backend's own message (`SpeechController.php:76`) |
| Other failure | `Couldn't load this speech — try again.` — parallel to `ReviewerDirectory.tsx:78` |
| Dashboard live-card button | `Watch` — see §4 |
| Dashboard revoked-card line | `This speech isn't available to open.` |

### 3.4 Do not swallow the third tier

`SpeechController.php:86-100` returns a *reduced* object for the
invited-but-not-accepted tier (`speaker_name`, `invitation_message`,
`review_status`; **no** `user_id`, **no** `primary_video`). The frontend
`Speech` type does not model this tier — `user_id` is optional with a
"not confirmed" TODO at `web/src/features/speech/types.ts:62-67`. That path
renders a title plus "Not ready to play yet." today. Not broken, but the new
branching must not accidentally capture it.

---

## 4. Frontend change — `Dashboard.tsx`

The dashboard renders **no navigation at all** — verified first-hand:
`Dashboard.tsx:1-10` imports no router symbols, and `ReviewCard` never imports
`Link` or `Button`. `review.speech.id` is in the payload
(`ReviewController.php:140,152,164,176` all eager-load `speech.user`;
`ReviewResource.php:35-43` serializes `speech.id`; typed at
`web/src/features/review/types.ts:30-35`) and simply never rendered.

In `ReviewCard`'s `CardContent` (`:122-131`), after the timestamp:

```tsx
{!readOnly && review.speech?.id && (
  <Button size="sm" variant="outline" className="self-start"
          render={<Link to={`/speeches/${review.speech.id}`} />}>
    Watch
  </Button>
)}
{readOnly && (
  <p className="text-sm text-muted-foreground">This speech isn't available to open.</p>
)}
```

Notes:

- `readOnly` is already the flag distinguishing revoked cards (`:63-67` passes
  it only for the Revoked section), so no new prop is needed.
- `review.speech?.id` is optional (`whenLoaded`) and **must** be guarded;
  `:115` already guards the title the same way.
- `render={<Link …/>}` is the **only** button-as-link idiom in this repo
  (`MySpeeches.tsx:54`, `VerifyEmail.tsx:57,97`, `UserMenu.tsx:70`) — there is
  no `asChild`. Verified first-hand.
- Label is **`Watch`**, not "Open speech": that is the repo's existing label for
  this exact navigation (`MySpeeches.tsx:54`). Flagged because the original
  request said "Open speech" — this is a deliberate consistency choice, easily
  reversed.
- `render` has never been used inside a `&&` on an optional id in this repo, so
  run `tsc -b` on the actual edit.

---

## 5. Tests

### 5.1 Backend — none must change, 7 to add

**No test anywhere pins 404 for a revoked reviewer on `show()`.** That coverage
gap is why this was easy to get wrong. Every existing caller of the endpoint
uses either an owner or a genuine reviewless stranger:

| file:line | Caller | Verdict |
|---|---|---|
| `api/tests/Feature/Speech/SpeechOwnershipTest.php:31-38` | bare `User::factory()`, no review row | stranger — stays 404 |
| `api/tests/Feature/Review/ReviewInvitationHttpTest.php:48-62` | `$stranger`, no review | stays 404 |
| `ReviewInvitationHttpTest.php:17-45` | invited → reduced, accepted → full | both live, unaffected |

**The stranger's 404 is pinned by explicit intent, not just by assertion.** That
test is named *"refuses a stranger with 404, not 403, and confirms no
reviewable-speeches route exists anywhere"* — the "not 403" is deliberate and
named. This plan keeps it, and test 2 below strengthens it to assert the body
too. Nothing here weakens the stranger tier.
| `api/tests/Feature/Speech/SpeechAssetResourceTest.php:50,79,91` | owner | unaffected |

New cases belong in `ReviewInvitationHttpTest.php`, where the existing tier
tests live:

1. revoked reviewer → 403; assert `message === 'Access denied.'`, `code === 'speech_access_denied'`, and `expect($r->getContent())->not->toContain('revok')` — one substring catches both `revoked` and `revocation`.
2. stranger → 404 **with body** `message === 'No such speech.'` (strengthen the existing bare `assertNotFound()` so the privacy tier is pinned by body, not just status).
3. `declined` reviewer → 403.
4. `abandoned` reviewer → 403. *(3 and 4 as a Pest `->with([...])` dataset over `['declined', false], ['abandoned', false], ['accepted', true], ['published', true], ['invited', true]`, mirroring `VoiceAnnotationHttpTest.php:104-123`.)*
5. **re-invited-after-revocation → 200 reduced tier.** Pins §2.2: fails loudly if anyone ever adds a second row per pair or reintroduces an ordering assumption. Drive it through `ReviewService` (`invite` → `accept` → `revoke` → `invite`), **not** a factory, so it exercises the real tombstone-clearing path.
6. `revokeAndPurge` → 404 (row hard-deleted, reviewer is a stranger again). Pins the residual oracle in §6.2 deliberately.
7. owner → 200 full, accepted reviewer → 200 full (regression on untouched tiers).

`Review::factory()->accepted()->revoked()` already exists
(`api/database/factories/ReviewFactory.php:43,72`) and is used this way at
`SpeechPolicyCaptionsTest.php:72`, so cases 1-4 need no new factory state.
Verified first-hand: `ReviewFactory::revoked()` sets only `revoked_at`.

### 5.2 Frontend — 2 new files

Verified first-hand: **no `Dashboard.test.tsx` exists**, and
`web/src/routes/SpeechWatch.test.tsx` imports only `PosterFramePicker` and
`OverlayPositioner` — the page component itself is **never rendered by any
test**. That is why the hang shipped.

Stack: Vitest 4 + React Testing Library, jsdom, config inlined in
`web/vite.config.ts:38-47`. **No MSW** — every test stubs `fetch` directly via
`vi.stubGlobal('fetch', fetchMock)` with per-file `jsonResponse`/`urlOf`
helpers, `beforeEach(clearCookies)`, `afterEach(vi.unstubAllGlobals)`, and a
final `throw new Error('unexpected fetch: …')`. Rendering goes through
`renderWithProviders(ui, { route })` from `web/src/test/renderWithProviders.tsx`.

- **`SpeechWatch.test.tsx`** — new describe block rendering the default export
  via `<Routes><Route path="/speeches/:id" …/></Routes>` (PublicProfile-style,
  since the component reads `useParams`). Cases: 403 → access-denied copy and
  **not** `Loading…`; 404 → not-found copy; 500/network → `role="alert"` failure
  copy; successful owner fetch → title still renders (happy-path regression).
  The fetch mock must also answer `/api/user`, since `useGetMeQuery` fires.
  Model for status-specific assertions: `BecomeACoach.test.tsx:30-43`. Model for
  real `:param` matching: `PublicProfile.test.tsx:26-37`.
- **`Dashboard.test.tsx`** — new file. Cases: live `in_progress` review renders
  a link with `href="/speeches/{id}"`; `revoked` review renders the
  explanatory line and **no** link; a review arriving with `speech` omitted
  renders neither a link nor a crash (the `speech?.id` guard).

### 5.3 Manual / E2E verification needs seeding

Verified first-hand: `SELECT count(*) FROM reviews WHERE revoked_at IS NOT NULL`
= **0**. There is no revoked row in the database, so the new 403 branch is
**unreachable in the browser** without seeding.

To seed, add a **third** review to `api/database/seeders/E2ESeeder.php`'s
`seedSharedReviewedSpeech()` (line 206) — do **not** mutate `9201`/`9202`, which
`E2ESeederSharedSpeechTest` asserts are `accepted` and which the
reviewer-isolation specs depend on:

- A new reviewer user (e.g. `COACH_C_ID = 9006`) and review id (e.g. `9203`) —
  coach A and B cannot be reused on speech `9101` because of
  `uq_reviews_speech_reviewer`.
- Fields: `speech_id = 9101`, `reviewer_id = 9006`, `speech_owner_id = 9004`,
  `invited_by_id = 9004`, a realistic pre-revocation `status` (`accepted` or
  `published`), plus `revoked_at`, `revoked_by_id = 9004`, `revocation_reason`,
  `last_transition_at` — all written explicitly, following the seeder's own
  `updateOrCreate`-writes-every-column discipline, or the row will drift across
  re-seeds.
- The **stranger** control case needs no seeding: any user with no review on
  `9101` (e.g. id `41` or `44`) is already a genuine stranger.

Current live state for reference (verified): 5 review rows — `1` (speech 15,
reviewer 9005, `invited`), `2` (17, 9003, `published`), `3` (15, 9003,
`accepted`), `9201` (9101, 9003, `accepted`), `9202` (9101, 9005, `accepted`).
All `revoked_at` null. 4 speeches, none soft-deleted.

---

## 6. Risks and deferred items

### 6.1 `playback-url` divergence — DECISION NEEDED

After this change `show()` 403s a revoked reviewer while
`GET /speeches/{s}/assets/{a}/playback-url` still 404s. Verified first-hand,
`api/app/Http/Controllers/Api/SpeechUploadController.php:38-45`'s docblock says:

> *"everyone else (including an invited-but-not-yet-accepted reviewer) gets the
> same 404 a stranger would, never a 403 that would confirm the speech exists."*

**That stated rationale no longer holds** once `show()` 403s the same caller.
No leak either way (404 is stricter), but there is a real UX path: a reviewer
revoked **mid-session** has `speech` already cached in RTK Query, so
`SpeechWatch.tsx:112-117`'s `refreshUrl()` fires on TTL expiry and receives a
404 — landing in the player error path, not the new access-denied page.

**Recommendation:** align `authorizeGrantingAccess` to the same
owner/granting/else-403-when-a-row-exists logic **in the same commit**, and
update that docblock. If deferred instead, say so explicitly in the commit
message, or it will read as an oversight at review time.

### 6.2 Residual oracle: revoked (403) vs revoke-and-purged (404)

Verified first-hand: `ReviewService::revokeAndPurge` (`:289-303`) **hard-deletes**
the row. A purged reviewer therefore reverts to `$review === null` → 404. This
discloses the *purge*, not the revoke, and a reviewer cannot tell which branch
they are in without a comparison case. Correct and desirable — but pin it with
test 6 rather than leave it latent.

### 6.3 Soft-deleted speech never reaches the new branch

Verified first-hand: `Speech` uses `SoftDeletes` and the route
(`api/routes/api.php:91`) is plain implicit binding with **no `withTrashed()`**
anywhere (zero hits for `Route::bind`, `withTrashed`, `resolveRouteBinding`).
A soft-deleted speech therefore **404s at route resolution, before `show()`
runs** — so a revoked reviewer on a deleted speech gets 404, not 403. Probably
desirable, but it means the UI cannot distinguish "denied" from "deleted".
Decide deliberately; do not claim full consistency.

Related pre-existing inconsistency, out of scope: the annotation/essay/caption
families return **410** via `SpeechDeletedException` for a deleted speech,
while `show()` 404s at the route layer.

### 6.4 The same hang exists in two other routes — adjacent, not included

Verified first-hand:

| Location | Guard |
|---|---|
| `web/src/routes/Onboarding.tsx:43` | `isLoading \|\| !status` |
| `web/src/routes/ProfileEdit.tsx:124` | `isLoadingMe \|\| isLoadingProfile \|\| !profile \|\| !username` |

Both hang permanently on a non-401 failure, identically to §0.1. **Not included
in this plan's scope** — flagged because the fix shape is the same and because
the pattern is clearly systemic rather than a one-off.

`web/src/components/auth/AuthShell.tsx:24,32` looks similar but is a
**documented deliberate choice** (see its comment at `:33-34`); leave it.

Routes that already handle this correctly, for reference:
`ReviewerDirectory.tsx:52-58`, `BecomeACoach.tsx:25-44`, `PublicProfile.tsx:49-59`,
`Search.tsx:64-76`, `TranscriptPanel.tsx:29-42`, `EssayReadOnlyPanel.tsx:34-45`,
`ProfileTimelineFeed.tsx:51-60`.

### 6.5 The 404 on `show()` is not load-bearing privacy

Worth recording so the design is not over-defended. A stranger can **already**
confirm a speech id exists via at least five endpoints that return 403 rather
than 404 — `GET /captions` (pinned by `CaptionControllerTest.php:65-71`),
`GET /transcript` (`TranscriptControllerTest.php:49-58`), `POST /reports`
(`ReportHttpTest.php:55-68`), `POST /speeches/{s}/reviews`, and the
voice-preference routes.

This is an argument **for** the 403, not against the 404: keep `show()`'s 404
for strangers because it is free, but do not treat it as a system invariant it
has never been.

### 6.6 Doc drift noticed in passing

`api/app/Policies/SpeechPolicy.php:15-16` claims "the controller-level scope
remains the authoritative source per §7.3", but `SpeechController::show` never
calls `scopeVisibleTo` at all — only `SpeechArcService.php:50` does. Harmless;
worth a one-line correction while in the file.

Also: `SpeechPolicy::view` is **wider** than `scopeVisibleTo` (it admits
`invited`), and two endpoints reuse it (`VoicePreferenceController:16,25`,
`ReportController:41,47`), so a merely-invited reviewer can set a voice
preference and file a report on a speech they cannot watch. Pre-existing,
unrelated, not addressed here.

---

## 7. Implementation order

Each step is independently shippable and leaves the app in a working state.

| # | Step | Files | Why this order |
|---|---|---|---|
| 1 | Fix the hang (frontend branches 1, 2, 5 only — no 403 handling yet) | `SpeechWatch.tsx` | Pure bug fix, no backend dependency. Delivers most of the user-visible win on its own. |
| 2 | `SpeechWatch` tests for loading / 404 / failure | `SpeechWatch.test.tsx` | Pins step 1 before more branching lands. |
| 3 | Backend 403 + new exception | `SpeechController.php`, `SpeechAccessDeniedException.php` | Safe to land before any 403-specific frontend work — today's SPA ignores the status entirely (§0.2). |
| 4 | Backend tests 1-7 | `ReviewInvitationHttpTest.php` | Closes the coverage gap that allowed this. |
| 5 | Align `playback-url` (§6.1) + docblock | `SpeechUploadController.php` | Same commit as 3-4 if accepted; otherwise explicitly deferred in writing. |
| 6 | Frontend 403 branch (branches 3, 4) + its tests | `SpeechWatch.tsx`, `SpeechWatch.test.tsx` | Now has a real 403 to render. |
| 7 | Dashboard link + revoked line | `Dashboard.tsx` | Independent of everything above. |
| 8 | `Dashboard.test.tsx` | new file | First test coverage for this route. |
| 9 | E2E seed row (§5.3) | `E2ESeeder.php` | Makes the 403 reachable in a browser for manual verification. |
| 10 | *Option B only* — dashboard copy + gated `ReviewResource` field | `Dashboard.tsx`, `ReviewResource.php`, `ReviewController.php` | Only if §1 resolves to Option B. |

**Scope under Option A:** 4 files changed (`SpeechWatch.tsx`, `Dashboard.tsx`,
`SpeechController.php`, `SpeechUploadController.php`), 2 files added
(`SpeechAccessDeniedException.php`, `Dashboard.test.tsx`), 2 test files
extended, 1 seeder extended. **No migration.**

---

## 8. Verification status — what is proven vs. read

Stated honestly so this plan is not over-trusted.

**Verified first-hand against the live database or by direct file read:**
`uq_reviews_speech_reviewer`; `ck_reviews_status`'s six values; zero revoked
rows; the 5 current review rows; `ReviewService::invite`'s in-place tombstone
clearing; `ReviewFactory::revoked()`; `Review::ACCESS_GRANTING`;
`AnnotationPolicy`'s revoked gate **and** its existing `assertForbidden()` test;
the absence of any 403→404 remap in `bootstrap/app.php`;
`CaptionsDisabledException`'s shape and `code` convention; the
`ReviewerDirectory` error pattern; the nested-`<main>` trap; the three hang
sites; the missing `Dashboard.test.tsx`; `SpeechWatch.test.tsx`'s imports;
`playback-url`'s docblock; `revokeAndPurge`'s hard delete;
`ReportController`'s existing 403; `ReviewResource`'s unconditional
`revocation_reason`; `Dashboard.tsx`'s five "revoked" strings.

**Code-read only, not executed:**

- The per-endpoint status table in §0.2. Rows with a cited test are corroborated
  by an existing assertion; the **voice-preference** and **`restore`** rows are
  untested inference. Cheap confirmation if the consistency claim matters: a
  throwaway Pest file hitting all ~20 endpoints as one revoked reviewer,
  dumping status codes.
- The hang itself is proven by code inspection (RTK Query's documented
  `isLoading`/`data` semantics plus the total absence of an error path), **not
  by observation** — no dev server was started and no test suite was run during
  this review.
- `EXPLAIN` plan shape is sound but its cost numbers come from a 5-row table and
  are not representative.

**Not attempted:** executing the new 403 end to end. There is no revoked row to
exercise it with (§5.3), and creating one would have been a write.


---

## 9. What changed during implementation

Recorded because the plan was written before the code was, and three things
turned out differently.

### 9.1 `playback-url` was aligned, not deferred (§6.1)

The plan left this as a decision. It was taken: `authorizeGrantingAccess` now
403s any caller holding a non-granting row and keeps the stranger's 404, and
the docblock's stale "never a 403 that would confirm the speech exists"
rationale was rewritten. Verified live — revoked reviewer 403, stranger 404,
accepted reviewer 200.

This also widened the change slightly beyond the plan: a merely-`invited`
reviewer now gets 403 from `playback-url` rather than 404. That is consistent
(`show` already discloses the speech to them via the reduced tier) and is
covered by the new test.

### 9.2 `nativeButton={false}` was tried and rejected

Base UI warns when `render` swaps a non-`<button>` into a `Button`. Setting
`nativeButton={false}` silences it, but it makes Base UI stamp
`role="button"` on the anchor — the wrong accessible role for navigation, and
it broke the `getByRole('link')` assertion that caught it. Reverted: the repo's
existing `render={<Link/>}` idiom is kept, the dev-only warning is accepted,
and the four older call sites behave identically. Worth a separate sweep.

### 9.3 Tests caught a test bug, not a product bug

The first `SpeechWatch` run crashed in `useVoiceCommentaryPreference` on
`Cannot read properties of undefined (reading 'speech_id')`. Cause was the new
test's own fetch mock: `/api/me/preferences/voice-commentary/{id}` is nested
under `/api/me`, so a loose `includes('/api/me')` matcher swallowed it and
handed the hook an identity payload. Fixed by matching the specific route
first.

Worth noting as a latent fragility, though: `serverPreference?.voice_commentary
.speech_id` optional-chains only the first hop, so a malformed payload crashes
the page rather than degrading. Pre-existing and out of scope here.

### 9.4 Seeder fixture — a third coach, and one thing the plan missed

Implemented as planned (`COACH_C_ID = 9006`, `REVIEW_COACH_C_REVOKED_ID =
9203`, `coach-c@e2e.test`), leaving `9201`/`9202` untouched.

The plan did not anticipate that `revocationColumnsFor` must write
`revoked_at`/`revoked_by_id`/`revocation_reason` **explicitly as null for
coaches A and B too**. Without that, a spec that revokes a live review would
survive every future re-seed and silently convert an `accepted` fixture into a
revoked one — the same trap the essay columns already documented. There is now
a test for exactly this.

Also confirmed before adding the row: `ReviewController::forSpeech` filters
both `ACCESS_GRANTING` and `revoked_at IS NULL`, so the revoked third review
stays out of the speaker's roster and `E2ESeederSharedSpeechTest`'s exact
two-reviewer assertion still holds.

### 9.5 Host environment notes

`vendor/bin/pest` is not in the `app` image (built `--no-dev`); the suite runs
from the host's `api/vendor`. Both Pest and PHPStan exceed the host's 128 MB
`memory_limit` on this repo — run them as `php -d memory_limit=1G vendor/bin/pest`
and `phpstan analyse --memory-limit=2G`. Neither is related to this change.

`api/` is baked into the app image with no bind mount, so verifying any backend
change live requires `docker compose build app && docker compose up -d app`.
