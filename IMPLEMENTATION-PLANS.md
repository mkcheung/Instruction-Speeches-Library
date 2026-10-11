# Implementation Plans — all ten improvements from `UX-REVIEW-BY-ROLE.md`

**Date:** 2026-10-10 · **Branch:** `development` (HEAD `8b142c4`) · **Status:** proposals, nothing built

Companion to [UX-REVIEW-BY-ROLE.md](UX-REVIEW-BY-ROLE.md), which diagnosed; this plans. Items keep that document's numbering (§7.1 → §7.10) so the two can be read side by side.

---

## 0. Provenance, and how to read this

Four of these plans (§7.2, §7.5, §7.6C, §7.7) were investigated by dedicated sub-agents, one per feature, each owning its own vertical slice — backend, frontend and schema together — so that no finding had to be reconciled across a layer boundary. The remaining six were worked directly.

**Every agent claim that this document repeats as fact was independently spot-checked** against the working tree before being written down. That mattered: the agents overturned several conclusions in the UX review, and one of them cited a line number that does not say what it was claimed to say. §2 lists every correction, including corrections to my own earlier document and one to an agent.

Three conventions carried from the repo's own documents:

- A claim without a `file:line` citation is an inference, and says so.
- ⚠️ marks something unverified **at the point of use**, not only in a footnote.
- A `PLAN-*.md` file describing a feature is **not** evidence the feature exists. Several describe proposals that were never built.

### The four house rules every plan below respects

1. **The `Gate::before` standing rule.** `api/app/Providers/AppServiceProvider.php:300-381` is a *scoped* admin bypass with a `$mustFallThrough` allowlist, dispatched at `:380` by **ability string only, never by model**. The rule at `:331-337`: an ability that is not in the list is an unconditional admin `true`. Every new ability must be added in the same commit.
2. **The one-row invariant.** The access grant and the annotation set are a single `reviews` row — the design decision that answers the 2013 app's unfixable missing-author column. Any diff that writes to `reviews` outside §7.2 has left its plan.
3. **No open pool.** There is deliberately no endpoint listing reviewable speeches. `ReviewInvitationHttpTest.php:202-237` enforces this by walking the route table and forbidding the URI fragments `reviewable`, `review-pool`, `reviews-available`, `open-pool`. It is a tripwire; name new routes accordingly.
4. **Zero cost, self-hosted.** No paid SaaS. This constraint is load-bearing in exactly one plan (§7.6C) and is the reason that plan has a prerequisite rather than a start date.

### Environment traps that produce misleading failures

| Trap | Consequence | Correct form |
|---|---|---|
| Host `php.ini` caps memory at 128M | `pest` and `phpstan` crash in ways that look like test failures | `php -d memory_limit=-1 vendor/bin/pest` |
| `web/tsconfig.json` has `"files": []` | `tsc --noEmit` **checks nothing and exits 0** | `npx tsc -b` (= `npm run typecheck`). A web type error also fails the e2e `web/dist` build |
| `.github/workflows/ci.yml:319` names specs explicitly | **A new Playwright spec never runs in CI unless added to that line** | Add the filename in the same commit as the spec |
| `api/` is baked into the app image | A running container will not reflect working-tree edits | Rebuild, or you are debugging a ghost |
| Vite dev server stalls for minutes under host load | Reads as an e2e failure; `auth.setup.ts:28-43` documents it and three disproven hypotheses | Known environment issue, not a code bug |

---

## 1. Sequencing

| Phase | Items | Rationale |
|---|---|---|
| **1 — unblock** | §7.1 | Nothing else matters while the only discovery surface returns nothing. Three lines + a backfill. |
| **2 — close the promise** | §7.2, §7.3 | Revoke makes the headline guarantee exercisable; the notification layer makes the payoff visible. Together they complete invite → feedback → control. |
| **3 — make it legible** | §7.4, §7.9 | Feedback visible by default; a front door that explains the product. Near-pure frontend. §7.4 **must follow §7.2** (§13 seam 1). |
| **4 — trust and law** | §7.5 | Owner speech delete. Highest-risk item, and **specified in the plan already** (§7.5 §1) — which changes the design from the one the UX review recommended. |
| **5 — the scheduled step** | §7.7 | This *is* STEP-15, which is next in `STEPS.md` anyway. Carries two acceptance criteria that cannot be met as written. |
| **6 — small, independent** | §7.8, §7.10 | Fit alongside anything. §7.10 needs no migration after all. |
| **7 — blocked** | §7.6C | ⚠️ Has a hard prerequisite that is not a code task. Do not schedule until §7.6C §2 is resolved. |

**A reasonable first sitting is §7.1 + §7.3 + §7.9**: one backend action, one notification class plus a broken-link fix, one placeholder page. No shared files, no ordering constraints between them, and together they move the product from "cannot be used" to "usable end to end."

---

## 1b. Decisions taken

Three items carried an open judgement call. All three are now settled and folded into their sections; recorded here so a reader does not re-litigate them.

| Item | Decision | Reasoning in one line |
|---|---|---|
| **§7.2** mandatory revocation reason | **`reason` is required only on the first revoke** — `Rule::requiredIf(… revoked_at === null)` | Both properties hold honestly: a first revoke cannot omit the reason, a retry is not rejected, and the existing idempotency test passes unchanged. Supersedes this document's own earlier proposal, which would have pushed a "treat 422 as success" special case into the frontend permanently (§7.2.5) |
| **§7.5** owner-delete purge window | **`media.owner_delete_quarantine_days`, default 1 day** | The dialog says "permanent"; one day keeps that nearly true and still rescues a same-day misclick. Copy must match: "erased within 24 hours" (§7.5.3) |
| **§7.7** coach-side accessible surface | **`AnnotationList`, not a second `Transcript`** | Four of §8.6's six properties already hold, the fifth is one attribute, and duplicating the component would put two identical lists on one screen and risk a Playwright strict-mode collision (§7.7.1) |

**The §7.7 decision turned up a requirement while being settled.** Checking Base UI's `TabsPanel` showed it unmounts inactive panels by default, and only one panel in `SpeechWatch` opts out — so **neither** candidate list is "always available" today, which §8.6 explicitly requires. Adding `keepMounted` to the reviewer's `notes` panel is now part of §7.7, and it would have been required under the rejected option too. That moved one item off §14's unverified list.

---

## 2. Corrections — to the UX review, and to one agent

Recording these because this document's value depends on it, and because three of them change what gets built.

### 2.1 Corrections to `UX-REVIEW-BY-ROLE.md`

| # | What the review said | What is true | Effect |
|---|---|---|---|
| C1 | §7.5: ship **hard delete** with consequences named; soft delete is "safest, most code" | **Backwards for this codebase.** The `reviewer_annotations` export — the mitigation the recommendation explicitly leans on (`Account.tsx:36-41`) — reads `Review::query()` (`GenerateDataExport.php:157`). A hard delete CASCADEs `reviews` away (`reviews` migration `:84`/`:95`), so that export would be **empty**. `reviews` has no `deleted_at` ever (`:37-39`), so the mitigation exists *only* under soft delete. Hard delete also needs **more** code: no sweep reclaims a force-deleted speech's bytes | **Design reversed.** §7.5 now plans soft-delete |
| C2 | §7.5: owner deletion is "genuinely unspecified"; §11.1 is the relevant gap | **Specified.** `MODERNIZATION_PLAN.md:2053` — "Speaker deletes a speech while a coach is annotating… denies with **410 Gone**… the client shows 'your draft is preserved below'" — with the acceptance criterion at `STEP-07-write-commentary.md:63`. §11.1 is about legal groundwork (lawful basis, privacy notice, retention schedule), not this feature | Plan weighs options against a written criterion, not a blank slate |
| C3 | §7.2: each verb has "a service method, a policy, **an audit entry**, and a voice-note byte purge path" | **No audit entry exists for any of the four.** `ReviewService.php` contains zero `AuditLog` references, and `AuditAction` has no review-related constant | Audit is work to **add**, not reuse |
| C4 | §7.2 risk mitigation: reuse "the already-built 10-second-delayed `PurgeDeletedVoiceAnnotation` dispatch" | **Wrong job.** `revokeAndPurge` uses `PurgeVoiceAsset::dispatch(...)->afterCommit()` with **no `->delay()`**. The 10-second delay is on a different job in a different path | There is no undo window today. Either add the delay or stop citing it |
| C5 | §7.2 / §7.4: add the counts to `ReviewResource` once and share | Defensible, but the agent argues against it: `ReviewResource` is shared by the reviewer's own dashboard, where a drift-prone counter cache has no consumer. **They are real `SMALLINT` columns, not `withCount` aggregates** (`reviews` migration `:74-75`/`:112-113`), so there was never an N+1 risk to weigh | Resolved in §13 seam 1 |
| C6 | §7.10: needs an index on `(actor_id, created_at)`; `PLAN-ADMIN-DASHBOARD` §10 cut it | **Already exists.** The audit_log migration creates three indexes at `:73-75`, including that one. §10 cut indexes on *other* tables | **§7.10 needs no migration at all** |
| C7 | §7.1: "if any test asserts `roles: []` for a new user, this breaks it — grep first" | Grepped. `MeEndpointTest.php:68-96` asserts it but builds via `User::factory()`, bypassing `CreateNewUser`; the factory assigns no role. `RegistrationTest.php` makes no role assertion | **Zero test breakage.** One stale comment to update |
| C8 | §7.2: `two-users.spec.ts` is the invite→accept→publish flow to extend | It is a **leak-isolation** spec over pre-seeded fixtures — it never invites, accepts or publishes. And it **does not run in CI** (`ci.yml:319` lists five other specs) | Changes the test plan substantially |

### 2.2 A correction to an agent

The §7.5 agent cited `MODERNIZATION_PLAN.md:2310` as STEP-07's acceptance line for "410 Gone, not 404." **Line 2310 is about annotation keystrokes and `addCue` counts.** The criterion is real but lives at **`STEP-07-write-commentary.md:63`**. The substance survived; the citation did not. Corrected throughout.

---

# Part I — The six directly implementable plans

No plan document was needed for these; they are specified here in full.

---

## §7.1 Assign the `member` role at registration 🔴 **Do this first**

**Why:** `User::scopeReviewerCandidates` opens with `$query->role(['member', 'coach'])` (`api/app/Models/User.php:86`), correctly, because §7.1 of the plan requires that an admin can *never* appear as a reviewable candidate regardless of filters. But `CreateNewUser::create()` (`api/app/Actions/Fortify/CreateNewUser.php:41`) persists a user with **no role**, so every self-registered account fails that `whereHas`. The product's only discovery mechanism returns an empty set, permanently. Approved coaches are the sole exception — `CoachApplicationDecisionService:30` assigns `coach` — so the "Members" filter is dead and the whole directory is dead until a coach is approved by hand.

### Change table

| File | Change |
|---|---|
| `api/app/Actions/Fortify/CreateNewUser.php` | Capture the created user, `$user->assignRole(Role::MEMBER)`, return it. **`assignRole`, never `syncRoles`** — `RoleAssignmentService.php:55-62` documents that `syncRoles` *replaces* and has caused a real bug here. Add a comment noting this is a system act at account creation, so it correctly bypasses `RoleAssignmentService` (the same exemption `CoachApplicationDecisionService` documents) — otherwise the next reader files it as a violation of the "never call `assignRole()` directly" rule |
| `api/app/Models/User.php` | **Add `->whereNotNull('username')` to `scopeReviewerCandidates`, same commit.** `first_name`/`last_name`/`username` are nullable and populated only at onboarding step 1 (`2026_08_07_004005_add_identity_columns_to_users_table.php:24-30`), and `ReviewerDirectoryResource` renders `trim("{$first_name} {$last_name}")` — so a register-and-abandon account would become a **blank, invitable** directory row with an empty name, a bare `@`, and a `Member` badge. A user with no username also has no resolvable `/u/{username}` profile, so they are not addressable as a reviewer in any case |
| `api/database/migrations/` | One backfill: `member` for every user with no role. Scope it `whereNull('anonymized_at')` — `AccountErasureService` anonymizes in place rather than deleting, and a re-roled ghost would reappear in the directory |
| `api/tests/Feature/Auth/RegistrationTest.php` | New: a freshly registered user holds `member` and appears in `scopeReviewerCandidates` once a username exists — and does **not** appear before |
| `api/tests/Feature/Auth/MeEndpointTest.php` | Comment-only. `:70-72` justifies its fixture with "registration assigns no role, so `roles: []` is the normal case" — true of the factory, no longer true of registration. The test still passes (C7); the comment misleads |

**Do not "simplify" `web/src/lib/roles.ts` afterwards.** It is deliberately written so `roles: []` is the normal case and nav is additive-only. That stays correct after this change; it just stops being load-bearing. It is defence in depth.

**Risk:** low. The only behaviour that changes is directory visibility, which is currently broken. ⚠️ Open product question the plan does not answer: assign at registration (chosen here, with the username guard) or at onboarding completion? Registration keeps role state simple — every account is a member — and the guard handles the consequence.

---

## §7.3 The notification layer 🟠

Bigger than the UX review's "add one notification class." Three defects, one commit.

### (a) Nothing announces published feedback

`ReviewService` notifies on invite (`:137`), accept (`:191`) and decline (`:216`). `publish()` at `:407` notifies nobody, and no `ReviewPublished` class exists. The payoff moment of the product is its only unannounced event.

### (b) ⚠️ Every mail deep link in the product is dead

`url()` resolves against `APP_URL` = `https://api.speechcoach.test` (`api/.env:5`). The SPA is at `FRONTEND_URL` = `https://app.speechcoach.test` (`api/.env:127`). `config('app.frontend_url')` exists (`api/config/app.php:70`) and is already used correctly by `api/routes/web.php:20` — the notifications simply don't use it.

| Notification | Link | Broken how |
|---|---|---|
| `ReviewAccepted.php:39` | `url("/speeches/{$speech->ulid}")` | wrong origin **and** a ULID against a route that does `Number(id)` (`SpeechWatch.tsx:81`) |
| `ReviewDeclined.php:39` | same | same two |
| `ReviewInvited.php:41` | `url('/reviews')` | wrong origin **and no `/reviews` route exists** — the dashboard is `/dashboard` (`App.tsx:128`) |
| `CoachApplicationApproved.php:39` | `url('/profile')` | wrong origin only |

`SpeechTakenDown.php:31-36` omits its button deliberately, for an unrelated reason (a soft-deleted speech 410s), so its author did not catch this.

### (c) ⚠️ Three notification types render as the words "a speech"

The backend emits eight `type` strings; `NotificationBell.tsx:25-48` handles five. `speech.taken_down`, `user.suspended` and `user.deleted` fall through to `default: return speech` (`:45-46`), where `speech = title ?? 'a speech'`. **An account-suspension notice therefore appears in the bell as the literal string "a speech."** `SpeechTakenDown.php:37-39` has recorded its own missing case since STEP-12.

### Change table

| File | Change |
|---|---|
| `api/app/Support/FrontendUrl.php` *(new)*, or a helper on an existing support class | `frontendUrl(string $path): string` over `config('app.frontend_url')`, mirroring `api/routes/web.php:20`'s `rtrim(...).'/login'` idiom. One place for the origin |
| `api/app/Notifications/ReviewPublished.php` *(new)* | Copy `ReviewAccepted.php` exactly — `ShouldQueue`, `use Queueable`, `via() => ['mail','database']`, `toArray` delegating to `toDatabase`. Payload: `type: 'review.published'`, `review_id`, `speech_id`, `speech_title`, `actor_name`, `published_count`, `url` |
| `api/app/Services/ReviewService.php` | In `publish()`, inside the transaction: `DB::afterCommit(fn () => $locked->speechOwner->notify(new ReviewPublished($locked, $delta)));`. **`afterCommit` is non-negotiable** — `:161-170` documents why (`config/queue.php` sets `after_commit => false` on every connection, and `DB::transaction` nests as a SAVEPOINT). **Debounce: fire only when `first_published_at` was null before this call.** `publish()` is incremental by design and a coach may press it repeatedly; notifying every time trains the speaker to ignore the bell |
| `api/app/Notifications/*.php` (all 8, + the new one) | Route every `->action()` through the new helper, and fix the two identifier bugs: `{$speech->id}`, not `{$speech->ulid}`; `/dashboard`, not `/reviews`. Add `url` to each `toDatabase()` payload |
| `web/src/features/notification/types.ts` | Add `'review.published'` to the union; add `url?: string` |
| `web/src/components/layout/NotificationBell.tsx` | Add **four** cases: `review.published`, `speech.taken_down`, `user.suspended`, `user.deleted`. Render each row as a `<Link to={notification.data.url}>` that marks read on click, keeping the `<button>` for rows with no `url`. The enumerated-switch discipline its own comment at `:37-40` asks for is currently not held — restate it |
| `api/tests/Feature/` | Notification sent on first publish, **not** re-sent on the second. A test asserting every emitted `type` has a bell case would be better still, but crosses the PHP/TS boundary — do it as a vitest fixture listing the eight strings |

**Risk:** low, all additive. ⚠️ Unverified: whether any mail-content test asserts the current (broken) URLs — grep `api/tests` for `speeches/` and `url(` before committing.

---

## §7.4 Make the speech page show, not hide, the feedback 🟠

**Why:** `useCommentaryTrack.ts:66` initialises the selection to `NO_COMMENTARY`, and the chips at `TrackSelector.tsx:77-99` render only `option.label`. The default state of the screen whose purpose is displaying feedback is *displaying none*, and finding out which reviewer published requires clicking every chip in turn.

### Change table

| File | Change |
|---|---|
| *(counts)* | **Consumes what §7.2 adds** — see §13 seam 1. §7.4 must follow §7.2, or it inherits a decision that is §7.2's to make |
| `web/src/hooks/useCommentaryTrack.ts` | Default `selected` to the review with the most recent `last_published_at` (already on the wire, `ReviewResource.php:33`), falling back to `NO_COMMENTARY` when none has published. **Keep `NO_COMMENTARY` explicitly selectable** — "just let me watch myself" is a real intent |
| `web/src/components/review/TrackSelector.tsx` | Count badge and an unread dot per chip. ⚠️ **Extend the accessible name, never replace or split it** — see §12 |
| `web/src/lib/lastSeenCommentary.ts` *(new)* | `localStorage` keyed on `(speechId, reviewId, last_published_at)`, mirroring `annotationDraftStorage.ts`. No backend needed for "new since you last looked" |
| `web/src/routes/SpeechWatch.tsx` | Decouple the Essay tab. Its content is driven by a selection made in a *sibling* tab (`:431-437`), so opening Essay first yields "Pick a reviewer to see their essay" with no picker in sight (`EssayReadOnlyPanel.tsx:29-31`). Either lift the chip row above the `TabsList` so it visibly governs both panels, or add a compact picker inside the Essay panel |

**Risk:** low, but changing the default selection changes what `OverlayStack` renders on first paint. `OverlayStack.test.tsx` and `TrackSelector.test.tsx` both assert current behaviour. See §12 for the Playwright constraint — it is tighter than it looks.

---

## §7.8 Surface storage and upload limits 🟡

**Why:** `QuotaService` enforces 5 GiB and a hard cap of 2 concurrent uploads atomically, in a single `UPDATE … WHERE storage_bytes_used + ? <= quota_bytes AND uploads_in_flight < 2` (`:77-78`) — never check-then-act, which is right. But the limits are invisible until they fire as *"This upload would exceed your storage quota, or you already have 2 uploads in progress."* That one string conflates two problems with two different remedies: one means "delete something", the other means "wait".

| File | Change |
|---|---|
| `api/app/Http/Resources/UserResource.php` | Add `storage_bytes_used`, `quota_bytes`, `uploads_in_flight`. `/api/me` is already fetched on every authenticated route and RTK Query dedupes, so this costs no request |
| `web/src/features/auth/types.ts` | Extend `CurrentUser` |
| `web/src/components/speech/UploadDashboard.tsx` | A quota meter above the picker, plus a **pre-flight client-side check** against the selected file's size — "this file is 1.2 GB and you have 400 MB left" beats a 422 after the upload starts. `UserResource::formatBytes` already exists in the Filament resource (`:155`) and can be lifted to a shared helper |
| `api/app/Services/QuotaService.php` | Split the message in two. Different cause, different fix, different copy |
| `web/src/routes/Account.tsx` | Show the quota beside the export/delete sections, where a user who needs to free space is already standing |

**Do not move the enforcement.** The atomic `UPDATE` is correct; the client check is advisory only.

---

## §7.9 A real landing page 🟡

**Why:** `web/src/routes/Home.tsx:5` renders *"Frontend foundation is up."* `/` is registered unguarded at `App.tsx:57`. Nothing in the app ever links there — a grep for navigation to `/` returns zero hits and logout goes to `/login` (`LogoutButton.tsx:55`) — so it is reached **only** from outside: the bare domain typed or bookmarked, a shared root link, an external referral. It is pure first-impression traffic.

Four things the page must say:

1. **What the product is** — you upload a video of yourself speaking and get timestamped coaching back.
2. **The privacy rule, plainly.** *"Nobody sees your speech unless you personally invited them"* is the differentiator against an unlisted YouTube link. It is the README's headline, it shapes the entire schema, and it is stated **nowhere a prospective user will read it**. Someone deciding whether to upload video of their own face has exactly one question and the site does not answer it.
3. **How the loop works** — upload → invite specific people → their notes fade in at the exact moment they apply. The fade-in-at-timestamp behaviour is the novel part and is invisible until you are already inside.
4. **A way in.** There is no Register or Log in link on the page at all.

**Change:** `web/src/routes/Home.tsx` only. Reuse `PageShell` and the existing `ui/` primitives — no new components, and explicitly **not** the designer-led visual pass `STEP-15` excludes by scope. Redirect an authenticated visitor to `/dashboard`, consistent with `getPostLoginDestination` in `web/src/lib/roles.ts`.

**Risk:** none. One file, no logic.

---

## §7.10 An audit log browser 🟡

**Why:** `audit_log` is append-only by design and written by every destructive admin action with a mandatory reason. It is readable in exactly one place — the last 50 rows for a single user on `ViewUser` (`:365`, `limit(50)` with no pagination, deliberately a summary). There is no `AuditLogResource` in `api/app/Filament/Resources/`. So *"what happened this week?"*, *"what has admin X been doing?"* and *"when was this taken down, and by whom?"* all need database access. For the one table whose entire purpose is accountability, that is an odd stopping point — and it is what makes the super-admin role feel invisible, since overseeing other admins is precisely what distinguishes it.

| File | Change |
|---|---|
| `api/app/Filament/Resources/AuditLogResource.php` *(new)* | Read-only table: timestamp, actor, action, subject, reason. **No `recordActions`, no `toolbarActions`, no create/edit/delete** — otherwise it stops being an audit log. Filters on actor, action and date range |
| | ⚠️ `action` is deliberately free text with no CHECK (`audit_log` migration `:17-24`), so the action filter must be a `SelectFilter` built from `AuditAction`'s constants (or a distinct-values query), not an enum cast |
| | `canView()`/`canAccess()` gated to `Role::ADMIN_TIER`, following `ModerationQueuesWidget.php:118-123`. **Never a policy** — no `viewAny` exists in `api/app/Policies/` and Laravel's missing-method fallback is `Response::allow()`, so a policy gate here would silently allow everyone while reading like a restriction. That trap is documented; don't walk into it |
| `api/app/Filament/Resources/UserResource.php` | A "holds elevated access" filter, so a super-admin can see the admin roster in one view |

**No migration.** C6 — the three indexes already exist (`audit_log` migration `:73-75`), including `(actor_id, created_at)` and `(action, created_at)`. The only arguably-missing one is a bare `(created_at)` for the default newest-first listing, and at this table's size it is not worth buying.

**Risk:** low, provided it stays read-only.

---

# Part II — The four investigated plans

---

## §7.2 The reviewer roster, with revoke 🔴

A re-scope of `PLAN-WATCH-REVIEWERS-TAB.md` §4.2, whose own §10.2 retracted its central premise and instructed that it "should be re-scoped accordingly before anyone picks it up."

### §7.2.1 What the four verbs actually do

Every row below read from `api/app/Services/ReviewService.php` and verified independently.

| | `withdraw` (`:232`) | `abandon` (`:309`) | `revoke` (`:264`) | `revokeAndPurge` (`:289`) |
|---|---|---|---|---|
| **Who** | the reviewer (`ReviewPolicy:56-65`) | the reviewer (`:67-76`) | owner **or** admin-tier (`:83-86`) | owner **or** admin-tier (`:88-91`) |
| **Guard** | `invited`/`accepted`/`in_progress`, not revoked | `accepted`/`in_progress`, not revoked | none — any status, any time | none |
| **Status after** | `declined` | `abandoned` | **unchanged** — a `published` review stays `published` | n/a, row gone |
| **Columns** | `status`, `responded_at ??=`, `last_transition_at` | `status`, `last_transition_at` | `revoked_at`, `revoked_by_id`, `revocation_reason`, `last_transition_at` | **the row is `DELETE`d** (`:301`) |
| **Annotations** | untouched | untouched | untouched | **hard-deleted by FK cascade** (annotations migration `:57`/`:64`, `ON DELETE CASCADE`) |
| **Essay** | untouched | untouched | untouched | **destroyed** — `essay_html`/`essay_text`/`essay_published_at` are columns *on `reviews`* |
| **Voice bytes** | — | — | — | `PurgeVoiceAsset::dispatch(...)->afterCommit()`, **no delay** |
| **Idempotent** | yes | yes | yes, and deliberately does not re-stamp (`:270-272`), so a retry cannot blank the reason the reviewer was shown | **no** — a second call `firstOrFail()`s → 404 |
| **Audit** | **none** | **none** | **none** | **none** |
| **Notification** | **none** | **none** | **none** | **none** |
| **Reviewer's next load** | **403** `speech_access_denied` | **403** | **403** | **404** (no row → stranger tier) |

Two further verified findings:

- **`revokeAndPurge(Review $review, User $actor)` never uses `$actor`.** The closure captures `use ($review)` only. `ReviewController::revokeAndPurge:93` already passes the current user in. That is exactly the parameter an audit write consumes.
- ⚠️ `reviews.voice_erasure_started_at` is **not** part of the revoke path. It is the *reviewer's own account-erasure* interlock. `revokeAndPurge` never touches it.

### §7.2.2 Where this departs from §4.2

| §4.2 said | This says | Why |
|---|---|---|
| The roster is "nearly free" — the data is already fetched | **Not free; needs a new endpoint** | `forSpeech` filters `whereIn('status', ACCESS_GRANTING)->whereNull('revoked_at')` (`ReviewController:202-203`), so `invited` — the status a speaker most needs — can never reach the browser |
| `?include=pending` on the existing route | **A separate `GET /speeches/{speech}/review-roster`** | §7.2.3 |
| Group as Invited / In progress / Published | **Four groups**, with `declined`, `abandoned` and revoked collapsed into one "Closed" | Three one-row sections is noise; they share one user-meaningful property — nothing more is coming — distinguished by a per-row sub-label |
| Revoke is the whole action story | **Four actions across two surfaces**, and withdraw/abandon belong on the **Dashboard**, not only the composer | The composer only mounts when `asset?.status === 'ready' && initialUrl` (`SpeechWatch.tsx:486`) — a coach invited to a still-transcoding speech would have **no exit at all** |
| Reuse `StatusBadge` conventions | **They don't apply** | `StatusBadge` is entirely `SpeechAsset['status']`-shaped — it takes `{ speech }`, reads `speech.primary_video`, and embeds a retry mutation. The reusable precedent is the bare `<Badge variant>` at `Dashboard.tsx:148` and `CoachApplicationStatusBadge`'s status→label map |

### §7.2.3 The API design

**Recommended: a separate owner-scoped endpoint, not a query parameter.** Weighed:

- `?include=pending` is the cheapest backend diff but the expensive frontend one. `listSpeechReviews` is keyed on a bare `speechId` (`reviewApi.ts:43-45`); sending a param means either widening that hook's cache key — touching the one file house rule 3 exists to protect — or declaring a second endpoint on the same URL, which because the panel is `keepMounted` (`SpeechWatch.tsx:476`) fires on **every** owner page load. And the guard stays a convention: nothing stops a later caller passing it from `useCommentaryTrack`.
- A separate endpoint makes the constraint **structural rather than conventional**, gets its own cache key and `providesTags`, and can serialise a different resource with counts and grouping without touching `ReviewResource`'s shape for five other consumers.
- ⚠️ Name it carefully. `ReviewInvitationHttpTest.php:202-237` walks the route table and forbids `reviewable`, `review-pool`, `reviews-available`, `open-pool`. `review-roster` violates none of it. **Run that test first.**

Reuse `forSpeech`'s non-owner treatment verbatim: **404, never 403** (`ReviewController:196-198`, pinned by `E2ESeederSharedSpeechTest:74-77`).

Order by `last_transition_at desc, id asc`. ⚠️ `forSpeech` orders by `last_transition_at` only, while `ReviewResource.php:47-51` promises that two erased reviewers are disambiguated "by this list's stable `ORDER BY reviews.id ASC`". That tiebreak does not currently exist; the new endpoint should actually provide it.

**The counts:** put `annotations_count` / `published_annotations_count` on the **new roster resource only**, not on `ReviewResource`. They are real `SMALLINT` counter-cache columns (`reviews` migration `:74-75`/`:112-113`) with a `ck_reviews_counter_cache` CHECK, so there is no N+1 question (C5) — the question is drift. `ReviewResource` is shared by the reviewer's own dashboard, where a drifted number has no consumer and would be a support ticket. ⚠️ `AnnotationPolicy:62-66` is emphatic that these must **never** gate authorization ("a drifted counter would silently deny a speaker commentary they were actually delivered") — display only.

### §7.2.4 Groups

| Heading | Rows | Actions |
|---|---|---|
| **Awaiting a reply** | `invited`, not revoked | Revoke |
| **Working on it** | `accepted`/`in_progress`, not revoked | Revoke · Revoke and delete their work |
| **Feedback delivered** | `published`, not revoked | Revoke · Revoke and delete their work |
| **Closed** | any row with `revoked_at`, plus `declined`, plus `abandoned` | *(read-only in v1)* |

Revocation is **orthogonal to status** — there is no `revoked` status, only `revoked_at` (`E2ESeeder:383-388` seeds a revoked row with `status='accepted'` precisely so the fixture resembles reality). Per-row sub-labels carry the distinction: "Declined your invitation" / "Stopped working on this" / "You removed their access {date}" + reason. All three are facts the speaker caused or received, so there is no privacy concern in the speaker's own view — unlike the reviewer-facing 403, where `PLAN-ACCESS-DENIED-STATES.md` §2.1 requires they not be told apart.

**Re-invite is deferred.** `ReviewService::invite:105-123` already resets a revoked/declined/abandoned row in place with the tombstone cleared, so it needs no new backend — but it needs a message field, and it is impossible for an erased reviewer (no `reviewer.id` in the payload). Ship Closed read-only; the invite form is two inches below.

### §7.2.5 Backend changes

| File | Change |
|---|---|
| `api/routes/api.php` | `GET /speeches/{speech}/review-roster` beside `:211` |
| `ReviewController.php` | New `roster()`: copy `forSpeech`'s owner guard verbatim, **no status filter**, order `last_transition_at desc, id asc`. **Leave `forSpeech` byte-for-byte unchanged** |
| `ReviewRosterResource.php` *(new)* | `ReviewResource`'s fields + the two counts + `revoked_by_is_self` (a boolean, not `revoked_by_id` — the speaker does not need an admin's user id). **Copy `ReviewResource:67-74`'s erased-reviewer block with its comment**, don't re-derive it |
| `ReviewService.php` | **(a)** Four `AuditLog` writes — in `revoke` *inside* the already-revoked early-exit guard so a no-op retry logs nothing; in `revokeAndPurge` (this is what `$actor` is for); in `withdraw`; in `abandon`. **(b)** `DB::afterCommit(... notify(new ReviewAccessRevoked(...)))` in `revoke` and `revokeAndPurge`. ⚠️ **For `revokeAndPurge`, capture the payload as scalars *before* the delete** — the `Review` is gone by the time the callback runs and `SerializesModels` would fail to rehydrate it |
| `AuditAction.php` | Four constants, each with its call site in the same commit (the class's own rule at `:14-16` forbids stubs) |
| `ReviewAccessRevoked.php` *(new)* | **One notification only, to the reviewer, on `revoke` and `revokeAndPurge`.** Not for withdraw/abandon — those are the reviewer's own acts. The case for this one is the strongest on the list: a revoked coach's work becomes unreachable to them with zero signal, and after a purge the row is gone so even the dashboard's "Revoked" section never shows it. A purge today is completely silent and irrecoverable |
| `RevokeReviewRequest.php` | ✅ **DECIDED — `reason` is required only on the first revoke.** `Rule::requiredIf(fn () => $this->route('review')?->revoked_at === null)`, replacing today's `['sometimes','nullable','string','max:1000']`. `ReviewController.php:80` takes a route-model-bound `Review $review`, so the rule can read the current tombstone state — **verified**. This supersedes an earlier proposal in this document's own drafting (`required` on the request, nullable in the service), which would have made a legitimate retry 422 and pushed a "treat 422-on-already-revoked as success" special case into the frontend's error handling permanently. The conditional rule gives both properties honestly: a first revoke cannot omit the reason (house rule 4), a retry is not rejected, and `ReviewServiceTest:191-206` — which asserts `revoke($review, $speaker, null)` must not blank the stored reason — passes unchanged. **Leave `ReviewService::revoke`'s `?string $reason` signature and its `revoked_at !== null` early-exit guard (`:264-272`) exactly as they are**; they are what makes the service idempotent for the non-HTTP callers (§13 seam 3) |
| `AppServiceProvider.php` | Add `'review.revoke', 'review.purge'` to `$mustFallThrough`. Both are `Gate::define`d (`:165`, `:166`) but **absent from the list** (which holds only `review.withdraw`/`abandon` at `:307`), so an admin is short-circuited to `true` before `ReviewPolicy` runs. **Inert today** — the policy grants admin-tier anyway — but it becomes a live hole the moment the mandatory reason or any future condition moves into the policy. Exactly the bug class `:338-349` was written about |

### §7.2.6 Frontend, and the transition that matters

Speaker side: `ReviewerRoster.tsx` + `RevokeReviewDialog.tsx` (two modes in one component) into the existing `reviewers` tab above `InviteReviewerPanel`. **Follow `ClearAnnotationsDialog.tsx` exactly** — it is the codebase's only non-admin destructive-dialog precedent and already implements friction proportional to consequence: a mandatory reason for both modes, plus a type-the-word gate for purge only.

Coach side: **Withdraw + Abandon on `Dashboard.tsx`'s "In progress" section**, Abandon *also* in the composer footer. ⚠️ **Do not add Withdraw to the `invited` section** — `ReviewService::withdraw:242-243` lands it in `declined` with `responded_at ??= now()`, i.e. *identical to decline, minus the notification*. `InvitationCard` already has Decline. Two buttons with one outcome, one of which silently fails to tell the speaker, is a worse product than one button.

**⚠️ The sharpest detail in the feature — the post-withdraw state is broken today, traced:**

1. `POST /withdraw` → 200, status → `declined`.
2. `invalidatesTags: ['Review']` → `listMyReviews` refetches.
3. `useMyReviewForSpeech:33` filters on `ACCESS_GRANTING`; `declined` is not in it → `myReview` becomes `null`.
4. `SpeechWatch.tsx:486`'s guard goes false → **the entire "Your feedback" tab strip unmounts.**
5. **`speech` is still in cache.** Nothing invalidated the `Speech` tag — `speechApi` is a *different* `createApi` instance (`tagTypes: ['Speech','SpeechAsset']`), and cross-slice invalidation needs an explicit `dispatch(speechApi.util.invalidateTags(...))`. `getSpeech` has no polling interval.
6. **Result: the coach sits on a page with a title, a description, a still-playing video, and nothing else.** No tabs, no explanation, no navigation but the back button. The 403 branch at `SpeechWatch.tsx:233-272` and its "Back to my reviews" button are **never reached**.

**Fix: navigate to `/dashboard` on success *and* cross-slice-invalidate `Speech`** — so a coach who hits Back gets the honest 403 rather than a stale page. That requires `speechId` in the `withdrawReview`/`abandonReview` mutation args, which they don't carry today. **Those are exported hooks with zero call sites — free to change now, and it will never be this cheap again.**

⚠️ **One more state bug, pre-existing but newly reachable:** if the revoked reviewer was the *currently selected* commentary track, `useCommentaryTrack`'s `selected` still holds that id while `options` no longer contains it, and `getAnnotations` is not invalidated — so stale overlays keep rendering under a chip that no longer exists. Reset to `NO_COMMENTARY` when the revoked id matches. (Reachable today via the admin panel's revoke, with no frontend involvement.)

`revokeAndPurgeReview` must be typed **`void`** — the endpoint returns **204** (`ReviewController:95`), so a `Review` result type is a silent JSON-parse failure.

### §7.2.7 Tests

Server-side coverage is good already — `ReviewServiceTest` pins revoke's status-preservation (`:130-141`), re-revoke idempotence (`:191-206`), re-invite in place (`:148-173`); `ReviewInvitationHttpTest:302-376` pins that all three denial causes 403 with a body that never says "revok". **Gaps:** no test covers `revokeAndPurge`'s cascade, withdraw's or abandon's column effects, or (obviously) the absent audit and notifications.

The one test that matters most: **`review-roster` returns all six statuses plus a revoked row, and `GET /reviews` on the *same fixture* still returns only the ACCESS_GRANTING non-revoked subset — both assertions in one test.** That is the house-rule-3 regression guard, and it only works if both calls see identical data.

⚠️ **Playwright scope changes because of C8.** `two-users.spec.ts` is a leak-isolation spec, not an invite flow, **and is not in `ci.yml:319`** — extending it adds zero CI coverage unless that line changes too. And revoking reviewer A inside a CI run contaminates `essay-editor`, `captions` and `voice-annotations`, which all read A's fixtures. `E2ESeeder:380-390` resets revocation columns *between* runs, not within one. **Use `coach_c`/review `9203`, the already-seeded revoked row** — which needs a `coachC` entry in `fixtures.ts` and a fourth `auth.setup.ts` block, about 8 lines, and finally gives that fixture a browser-level consumer.

---

## §7.5 Let a speaker edit and delete their own speech 🟠

### §7.5.1 ⚠️ This is already specified — and not the way the UX review recommended

`MODERNIZATION_PLAN.md:2053`:

> **Speaker deletes a speech while a coach is annotating.** The policy resolves the speech **without trashed** and denies with **410 Gone** (distinct from 404, so the client can say something true). The client mirrors the draft to `localStorage` and shows "your draft is preserved below". An hour of a volunteer coach's time is the most expensive thing this system handles.

With the mechanism at `:2055` ("two-phase delete — mark, then purge … plus the nightly reconciler") and the acceptance criterion at **`STEP-07-write-commentary.md:63`**: *"Deleting a speech mid-annotation returns **410 Gone**, not 404, and the client shows 'your draft is preserved below'."*

§11.1 is about *legal groundwork* — lawful basis, privacy notice, data residency, retention schedule. It is a standing carry-forward, not this feature's blocker.

### §7.5.2 The design: soft delete, with hard-delete honesty in the UI

**`Speech` already uses `SoftDeletes`** (`Speech.php:13,62`; `deleted_at` in both driver branches of the migration) — the **opposite** of `User`, which deliberately omits the trait because a `users` row is an FK target that must survive. A `Speech` has no such constraint: nothing outside its own subtree references it except `speeches.supersedes_id`, which is `SET NULL`.

Why hard delete loses, four verified reasons:

1. **It is not simpler here.** `forceDelete()` fires the CASCADE, which does not touch storage, and **no sweep reclaims a force-deleted speech's bytes** — `MediaReconcileCommand::purgeQuarantinedTakedowns` selects `Speech::onlyTrashed()`, which a force-deleted row is not. So hard delete needs a **new** synchronous pre-CASCADE storage-purge loop in a web request. More code, not less.
2. **It breaks a shipped contract.** A force-deleted speech 404s where four controller families already 410 via `SpeechDeletedException`.
3. **It destroys the mitigation it leans on.** The argument for hard delete is that the coach's copy survives in the `reviewer_annotations` export. That export reads `Review::query()` (`GenerateDataExport.php:157`); a hard delete CASCADEs `reviews` away, so **the export would be empty**. `reviews` has **no `deleted_at`, ever** (migration `:37-39`), so the mitigation exists *only* under soft delete. This inverts the UX review's own reasoning (C1).
4. **It destroys third-party voice audio.** `PurgeSpeechMedia:43-54` deliberately spares `voice_note`: *"That audio belongs to the REVIEWER who recorded it, not to the speaker."* Hard delete must either make the opposite call or leak the bytes.

Nearly everything soft delete needs is already built: the trait and column; access revocation (the global scope — `Speech::scopeVisibleTo` is a `Speech::query()` scope, so the row is excluded *before* the grant is consulted, **zero new code**); the 410; `PurgeSpeechMedia` with its window re-checked in-job; the nightly sweep, which already selects **any** trashed speech with no filter on who deleted it; `QuotaService::releaseOnSpeechDeleted`, correctly gated to credit back only a `ready` `source` asset.

**Ship soft-delete as the mechanism and a typed-confirmation dialog as the interface.** No restore affordance for the owner in v1 — the window is an operational byte-purge window, not a user-facing trash can — so the copy must not promise recoverability. That is the same honesty posture `DELETE /account` already takes: it says "permanent" while the implementation anonymizes the `users` row. The claim is about **access and bytes**, not rows.

### §7.5.3 Two decisions this forces

**(i) The window needs its own config key.** 30 days of retained video after someone clicked "delete permanently" is weaker than the headline promise, and that figure exists to match the *user* soft-delete moderation grace — a wrongful-takedown appeal window, which an owner delete has no analogue for. ✅ **DECIDED: add `media.owner_delete_quarantine_days`, default 1 day.** Not zero: `quarantineHasExpired` uses `lessThanOrEqualTo(now()->subDays($days))`, so zero makes the eager dispatch purge immediately and turns a misclick into irreversible loss with no operator recovery at all. No document in the repo states a figure for owner-initiated removal, so this was a product call, taken on the grounds that **the dialog says "permanent"** — one day keeps that nearly true while leaving a same-day rescue path. The copy must match: **"Removed now. The video file is erased within 24 hours."** *(The cheap alternative considered and rejected: reuse `takedown_quarantine_days`'s 30 days, which would delete the new config key and the per-reason branch in the nightly sweep entirely. Rejected because it borrows a number sized for a wrongful-takedown appeal process that does not exist here, and would mean "delete" meant "invisible for a month.")*

**(ii) ⚠️ The `supersedes_id` slot trap must be fixed or this ships a visible dead end.** `SpeechService::assertLinkableSupersedes` checks successor occupancy with `Speech::withTrashed()`, because `uq_speeches_successor` has no `WHERE deleted_at IS NULL` clause — pinned by `SupersedeTest.php:99-113`, *"counts a soft-deleted successor as still occupying the slot."* So **a speaker who deletes v2 and uploads a replacement gets "That attempt already has a newer version."** On the most natural retry path in the product.

Fix without touching the index: in the delete service, inside the transaction, null `supersedes_id` on any successor (`withTrashed()`) and on the speech itself. That mirrors the hard-delete semantics `MODERNIZATION_PLAN.md:2119` already mandates — *"The chain breaks; the newer speech survives, unlinked"* — and makes soft and hard delete agree. **Writes to `speeches` only.**

### §7.5.4 ⚠️ The one-row invariant: write nothing to `reviews`

**Do not set `revoked_at`.** It is tempting — "revoke live grants" is literally in the UX review's own service description — and it is wrong three ways:

1. **Redundant.** The SoftDeletes global scope already excludes the speech from every read path. The soft delete *is* the revocation.
2. **Semantically false.** `revoked_at` means "the owner withdrew this person's access to a *live* speech", and `ReviewService::revoke` pairs it with `revoked_by_id` and a reason. Writing it files the coach's row in the dashboard's `revoked` bucket with a null reason, telling them something untrue.
3. **Destroys a reversal.** `restore()` clears `deleted_at` but cannot un-revoke; every grant would stay dead, so admin-restore silently stops working for owner-deleted speeches.

Any diff in this feature that touches `reviews`, `annotations` or `speech_transcripts` has left the plan.

### §7.5.5 Schema: one nullable column

`speeches.deleted_reason VARCHAR(16) NULL`, plain Blueprint (**not** driver-branched raw SQL — the create migration is raw only because of a CHECK and a partial index, and the `add_essay_columns` migration establishes the plain-Blueprint precedent for a simple `ADD COLUMN`). Plus `api/app/Support/SpeechDeletionReason.php` with `OWNER`/`TAKEDOWN` consts, mirroring `AuditAction`'s shape.

**No CHECK** — adding one would require rebuilding the whole `speeches` table on SQLite; `audit_log.action`'s open-vocabulary-plus-const-class precedent governs. **No `deleted_by_id`** — the actor is already in `audit_log`, which is indexed on `(subject_type, subject_id)`; what the audit log *cannot* do is drive an indexed `WHERE` on the nightly sweep or label a Filament column. **No backfill** — every existing non-null `deleted_at` is an admin takedown by construction, so **null must read as `takedown`** at both read sites.

⚠️ Add `@property string|null $deleted_reason` to `Speech.php`'s docblock. Mandatory, not decorative: the raw-SQL create migration defeats Larastan's column scanner, so every access is an "undefined property" error without it.

### §7.5.6 Backend, abbreviated

| File | Change |
|---|---|
| `SpeechPolicy.php` | `updateDetails()` and `destroyOwn()`, both `return $speech->user_id === $user->id;`. **No admin branch** — an admin removing content is `speech.takedown`, which already exists with a mandatory reason and a notification |
| `AppServiceProvider.php` | `Gate::define('speech.update'/'speech.delete')` **and both strings in `$mustFallThrough`, same commit** |
| `UpdateSpeechRequest.php` *(new)* | Four fields only: `title` (`sometimes,required`), `description`, `delivered_on`, `change_note`. ⚠️ **Exclude `captions_enabled`** (own route, side effects via `EnsureCaptionJob`) and **`supersedes_id`** — it *is* fillable, `assertLinkableSupersedes` runs only on create, and a slot collision would surface as an uncaught `QueryException` → 500 |
| `SpeechController.php` | `update()` + `destroy()`, both resolving through a **new private `resolveSpeech()` copied from `CaptionController:142-152`** so a trashed speech 410s instead of 404ing. Build the attribute array explicitly with `array_key_exists` guards — `preventSilentlyDiscardingAttributes` is on |
| `SpeechDeletionService.php` *(new)* | One transaction: `lockForUpdate`, early-return if already trashed (idempotent), break the chain (§7.5.3ii), set `deleted_reason` **before** `delete()` so no window exists where `deleted_at` is set and the reason is null, write the audit row, `DB::afterCommit` fan-out of `SpeechDeleted` to every access-granting non-revoked reviewer, dispatch `PurgeSpeechMedia` with the owner window passed explicitly |
| `GenerateDataExport.php` | **⚠️ The single highest-value line in this plan.** `:159` → `->with(['speech' => fn ($q) => $q->withTrashed()])`. Today the reviewer export emits `"speech": null` (`:177`) for a removed speech, so the coach keeps their work with **no indication which speech it belongs to**. The entire ethical case for owner deletion rests on that export being usable |
| `MediaReconcileCommand.php` | `purgeQuarantinedTakedowns` must branch per reason, passing the per-row window into `new PurgeSpeechMedia($speech, $window)` — the override exists precisely so a sweep cannot select rows the job then refuses. Rename it (`purgeQuarantinedRemovals`) |
| `SpeechResource.php` (Filament) | `deleted_at` is labelled **"Taken down"** — it would label an owner's own deletion a moderation action. Relabel, add a "Removed by" column. ⚠️ And **narrow `restore`'s `->visible()`**: today it would offer a moderator a Restore button on a speech its own owner deleted, undoing a user's privacy decision |
| `AuditAction.php` | `SPEECH_DELETED_BY_OWNER = 'speech.deleted_by_owner'`. Deliberately not `speech.deleted` — a bare value beside `speech.taken_down` invites exactly the conflation this plan exists to prevent |

### §7.5.7 ⚠️ Two naming traps

**(a) Do not name the policy methods `update` and `delete`.** `Gate::policy(Speech::class, SpeechPolicy::class)` is registered, so a method named `delete` also becomes reachable as the bare conventional ability string `'delete'` — and `$mustFallThrough` matches **on the ability string only, never the model**. So bare `'delete'` is not in the list, an admin gets the bypass, and one capability has two strings with two different answers. "Just add `'delete'` too" is **worse**: it would apply the fall-through to `'delete'` on *every* model, and Filament probes policies for conventional ability names. The in-repo precedent is `SpeechPolicy::updateCaptions` registered as `caption.update` — non-conventional method, dotted ability, no shadow. Hence `updateDetails` / `destroyOwn`.

**(b) Write-path 403 vs read-path 404.** `SpeechController::show` deliberately 404s a stranger; a bare `authorize()` on PATCH/DELETE yields 403. A write revealing existence where the read does not is a real information leak. **Mirror `show`'s four-tier logic on the writes.**

---

## §7.7 The keyboard map and accessibility pass (= STEP-15) 🟡

### §7.7.1 ⚠️ The finding that reframes the step

**The authoritative accessible surface does not exist on the authoring screen.**

`Transcript.tsx` — the `<ol aria-label="Commentary transcript">` that `STEP-15-accessibility.md:19` calls *"the authoritative accessible surface"* — has exactly one import site, inside `TrackSelector.tsx`, which has exactly one render site, inside `SpeechWatch.tsx`'s `{isOwner && (` branch. The coach/reviewer branch is a separate subtree rendering `AnnotationComposerPanel`, `EssayEditorPanel` and `TranscriptPanel` (the *caption* transcript, a different component) — and **no `Transcript`**.

So STEP-15's demo step *"Open the authoring surface… Instead, read the transcript list"* navigates to the one branch where that list is absent. The gap is **presence, not quality**. And `STEP-15:62`'s "if you have time for one thing, make that list excellent" is aimed at a list that is already very good, on the screen where it exists.

✅ **DECIDED: `AnnotationList` is the coach-side authoritative accessible surface.** Not a second `Transcript` instance.

§8.6's requirement is six properties — *"always available, `<ol>`, chronological, timecoded, `aria-current` on the playing row, click-to-seek"*. Checked against the coach's existing `AnnotationList`:

| §8.6 requires | `AnnotationList` today |
|---|---|
| `<ol>` | ✅ `AnnotationList.tsx:145` |
| chronological | ✅ sorted |
| timecoded | ✅ spoken timecode, `AnnotationRow.tsx:55` |
| click-to-seek | ✅ `AnnotationRow.tsx:49` |
| `aria-current` on the playing row | ❌ §7.7.2 — one line |
| **always available** | ❌ **see the mount finding below** |

Four of six already hold; the fifth is one attribute. Declaring this the authoritative surface reinterprets §8.6 rather than duplicating a component — and avoids a second `aria-label="Commentary transcript"` on the page, which would be a Playwright strict-mode ambiguity waiting to happen, and would put **two lists of the coach's own notes** on one screen.

### ⚠️ Newly verified, and it applies to *either* option: the panel unmounts

Read from the installed `@base-ui/react` 1.7.0:

```js
// node_modules/@base-ui/react/tabs/panel/TabsPanel.js
keepMounted = false,                              // :36  — the default
const shouldRender = keepMounted || mounted;      // :100
if (!shouldRender) { return null; }               // :101-102
```

And in `SpeechWatch.tsx`, **only** `<TabsPanel value="reviewers" keepMounted>` (`:476`) opts in. The reviewer's `notes` panel (`:493`) does not — nor does the speaker's (`:412`).

**So neither candidate list is "always available" today.** The coach's `AnnotationList` lives inside `AnnotationComposerPanel`, inside that `notes` panel, and is **removed from the DOM and from the accessibility tree** the moment the coach switches to Essay or Transcript. The speaker's `Transcript` has the identical problem. This was item 6 on §14's unverified list; it is now settled, and it resolves **against** the assumption that this property already held.

**Consequence for the decision: add `keepMounted` to the reviewer's `notes` panel (`SpeechWatch.tsx:493`) as part of this work.** One word. It would have been required under option B as well, so it is not a cost of the choice — it is a requirement the choice revealed. ⚠️ Also consider the speaker's `notes` panel (`:412`) for the same reason, though the speaker's path is not what STEP-15's demo script walks.

Write the reinterpretation down at the `AnnotationList` call site, or the next reader will file the absent `Transcript` as a bug and add the duplicate.

### §7.7.2 The highest-value fix in the step is one line

Within the *same list*, the two row components disagree:

- `VoiceAnnotationRow.tsx:82` — `<li aria-current={isCurrent ? 'true' : undefined} …>` ✅
- `AnnotationRow.tsx:45` — `<li className={cn(…, isCurrent && 'border-primary')}>` ❌

Both receive an identical `isCurrent` prop. **Text annotations therefore signal "current" by border colour alone** — a WCAG 1.4.1 (Use of Colour) failure *and* the missing `aria-current` §8.6 requires — while voice annotations in the same list do it correctly. One line, one attribute.

### §7.7.3 ⚠️ Two acceptance criteria cannot be met as written

`php artisan capability:matrix` **does not exist, and neither does the meta-test.** Verified independently: zero hits across `*.php`, `*.ts`, `*.yml`, `*.json`; the string appears in exactly **two markdown files**. There is no architecture-test directory in `api/tests/`.

So `STEP-15`'s *"The capability-matrix meta-test flips to zero-pending-allowed and passes"* and *"Every §7.1 cell is green or asserted-absent"* are unmeetable. §7.1's matrix itself is real and substantial (~45 capability rows × 3 roles in `MODERNIZATION_PLAN.md`) — but this is 15 steps of accumulated documentation drift, not a STEP-15 oversight.

**Re-scope, do not build.** A renderer for a 45×3 matrix plus a per-cell assertion registry is comfortably a week of backend work with zero accessibility value, inside a step whose own framing is *"Nothing new is added here."* Replace those two criteria with an explicit descope note saying §7.1 coverage is asserted today by per-endpoint Pest feature and policy tests.

### §7.7.4 ⚠️ Prerequisite: the Axe baseline window closes permanently

`STEP-15:22` requires *"Compare with the run you saved before this step."* **No baseline exists and no axe tooling exists** — `web/package.json` has no `@axe-core/playwright`, `axe-core`, `jest-axe` or `vitest-axe`; zero hits for `axe`/`lighthouse`/`a11y` across all four CI workflows; `artifacts/` holds only `whisper-smoke/`.

This is a sequencing trap, not a checklist item: **the moment the first fix lands, the "before" number is unrecoverable and the step's actual deliverable becomes unprovable forever.** Capture and commit the baseline JSON as commit #1.

Install `@axe-core/playwright` — `CP-15-accessibility-gates.md:39` names that exact package and supplies the spec skeleton. **Recommend against `vitest-axe`/`jest-axe`**: jsdom has no layout, so colour-contrast and target-size rules misreport. Lighthouse (`≥ 90` mobile) has no tooling either; given the documented Vite stalls, measure and record it manually rather than gating CI on it.

### §7.7.5 ⚠️ STEP-15's "every hook already exists" claim is stale — 2 of 6 don't

| Claimed hook | Reality |
|---|---|
| `data-visible` | ✅ `OverlayStack.tsx:99`, CSS at `index.css:203`, asserted 5× |
| a "curated `data-testid` module" | ❌ **Does not exist.** 53 inline string literals, no module. `PLAN-APP-HEADER.md:110` already flags this phrase as overstated |
| "every async state as a stable DOM attribute" | ⚠️ Partial. One purpose-built async seam (`transcript-sync-state`); not systematic |
| `E2ESeeder` | ✅ Plus two sibling seeders |
| the `login-as` route | ❌ **Does not exist** — zero hits in `api/routes`, `api/app`, `web/tests`. E2E auth drives the real login form |
| `FakeTranscoder` binding | ✅ Plus `FakeCaptionTranscriber`, `FakeClamScanner` |

Also stale: *"No Playwright"*. It is installed (`@playwright/test ^1.62.1`), with six configured projects and ten specs. **Add a keyboard-only spec** — jsdom has no real focus order, no video that plays and no layout, so this is precisely what Playwright is for, and `app-shell.spec.ts:72-77` already has the exact idiom (`Tab` → `toBeFocused()` → `Enter` → assert focus moved), including the `hasTouch` guard a keyboard spec needs verbatim.

### §7.7.6 The keyboard map, reconciled

`STEP-15:15-16` and `MODERNIZATION_PLAN.md:1758` (§8.6) differ in exactly one place: **§8.6 never mentions `Space`.** STEP-15's list is the superset and is authoritative — conveniently, since `Space` is also the only key video.js contests.

| Key | Action | Scope | video.js conflict |
|---|---|---|---|
| `Space` | play/pause | global, suppressed while typing | ⚠️ **The only contested key.** Two vjs components claim it and both deliberately `stopPropagation()`. **Attach bubble-phase on `document`, never capture** — then a focused vjs control wins and ours never double-fires. `Space` is also native activation for every `<button>`, so the guard must exclude `button`, `a[href]`, `[role=button]` |
| `J` / `L` | seek ∓5s | global, suppressed while typing | ✅ none — `userActions` is never set in `videojs-adapter.ts`, and vjs player-wide hotkeys are opt-in |
| `,` / `.` | step ∓1 frame | global, suppressed while typing | ✅ none. ⚠️ see below |
| `[` / `]` | prev/next annotation | global, suppressed while typing | ✅ none |
| `C` | stamp timestamp | **textarea + global** | ⚠️ see below |

⚠️ **`C` "inside the textarea" is unimplementable as a bare key** — a bare `c` in a `<textarea>` must insert the letter "c", and intercepting it breaks typing, the single most destructive thing this step could ship into a coach's authoring surface. **Recommend `Alt+C` keyed off `event.code === 'KeyC'`** (on macOS `Option+c` produces `ç`, so `event.key` is wrong) in textarea scope, **plus** bare `C` globally. Document it as a deliberate spec deviation rather than silently picking one reading.

The action already exists — `useAnnotationEditor.ts:517-519`'s `setToPlayhead`, bound to a visible button. This is a wire-up, not new state. And it composes correctly with the `onBeforeInput` boundary at `:521-543` for free: `setStart` sets `stampedRef`, and `handleBeforeInput` early-returns on it, so pressing `C` before typing correctly suppresses the later auto-stamp. **Explicit beats implicit, no new state.** The §8.4 rule is about detecting *text input*; a modifier chord is not text input and `onBeforeInput` cannot express it, so the two coexist without contradiction.

⚠️ **`,`/`.` has no frame rate to step by.** Frame rate is stored nowhere — `speech_assets` has `duration_seconds`, `width`, `height` and no `frame_rate`; the transcoder never normalises fps. `requestVideoFrameCallback` is unimplemented in Firefox, which CI runs. **Use a named `NOMINAL_FRAME_SECONDS = 1/30` constant documented as nominal** — annotation starts are `NUMERIC(10,3)` and the existing nudge step is already 0.5s, so this is a fine-positioning feel, not a frame-exactness guarantee. ffprobing a real fps into the schema is the honest fix if frame accuracy is ever required, and it contradicts "nothing new is added here".

**The typing guard:** port video.js's own `excludeElement`, which is already correct and battle-tested — exclude `isContentEditable`, exclude `<input>` unless its type is in `['button','checkbox','hidden','radio','reset','submit']`, exclude `<textarea>`. ⚠️ `isContentEditable` matters concretely: the essay editor is TipTap/ProseMirror, a `contenteditable` host, **not** a `<textarea>`. A guard checking only `tagName === 'textarea'` would fire `J`/`L` while a coach writes their essay.

### §7.7.7 What is already correct — protect it, don't rebuild it

- **The skip link is right.** `AppLayout.tsx:26-31` + `<main id="content" tabIndex={-1}>`, with a docblock explaining that a bare `href="#content"` scrolls without moving focus, "without it the skip link is theatre." Already Playwright-tested end to end.
- **Nothing moves focus to the playing row.** A grep for `.focus()` finds only TipTap toolbar returns and user-initiated row editing. **STEP-15 step 8 is satisfied by construction** — a regression to protect, not a gap to fix.
- **Timeline marker labels are already correct** — `Annotation at {spoken}`, never bare "1:23".
- **The bell's `modal={false}` is not an a11y problem** — a non-modal disclosure is the correct ARIA pattern, and it is deliberate so the header does not scroll-lock over a playing video.

Real remaining gaps: no roving tabindex on the timeline (30 notes = 30 tab stops); the drag handles are `role="presentation"` + `onPointerDown` only, so retiming is keyboard-inoperable (WCAG 2.2 2.5.7 — ⚠️ *arguably* already satisfied via the row editor's nudge buttons as an "Equivalent" exception; likely compliant with poor discoverability, needs a conformance judgement not a grep); `prefers-reduced-motion` covers only `.annotation-overlay`, not the Base UI popover/dialog transitions; and "announce commentary aloud" does not exist in any form — **the step's largest new build, and the first thing to cut**, since it is one demo-script step and is *not* in the acceptance list.

### §7.7.8 Backend: two tests, no production code

⚠️ **"The three flagship endpoints" are never enumerated** anywhere in `MODERNIZATION_PLAN.md` — six hits for "flagship", none naming them. Mapping from the three *screens* STEP-15 does name (annotation, playback, profile) gives: `GET /speeches/{speech}/annotations`, `GET /speeches/{speech}`, `GET /u/{username}/timeline`. **This is inference — confirm before writing the tests.**

Follow the house idiom at `ConnectionRailQueryCountTest.php:44-48` (`DB::enableQueryLog()` → request → assert), and copy its recorded lesson at `:58-63`: a substring filter was too loose and a naive regression "would have slipped past." **Assert the total count of queries touching the table, not just intended-shape queries.** The load check has a natural bound already — the ≤200-per-set cap enforced in `AnnotationService`. ⚠️ Assert query count and payload size; *record* timing rather than gating on it, since wall-clock is flaky on a loaded host.

---

## §7.6C Invite a reviewer by email 🟠 — **blocked on a prerequisite**

### §7.6C.1 ⚠️ This cannot ship until outbound deliverability is solved

> **No production mailer is configured anywhere in this repository.**

`api/config/mail.php:17` defaults to `log`. `compose.yaml:532-549` wires only `mailpit`, which "exists purely to intercept something". `STEP-14-deploy-hardening.md` — the deploy-hardening step — has **zero** matches for `mail`, `smtp`, `deliverab`, `spf` or `dkim`. No workflow sets `MAIL_*`. `scripts/deploy.sh:59` defers to a provisioning script in a sibling repo not present in this tree, so ⚠️ whether production sets `MAIL_*` at all is **unverifiable from here**. Given the `log` default, the most likely current state is that mail is written to `storage/logs` and delivered nowhere.

This is the **first feature that mails people who never signed up**. Every existing mail goes to an address that completed Fortify's own verification, where a deliverability failure is self-limiting — the account never activates and the user knows why. Here, a spam-foldered message means the *speaker* believes their coach was invited and the coach never hears anything. **There is no feedback loop at all.**

The plan already flags this as its own risk — `MODERNIZATION_PLAN.md:2555` (R13): *"Email deliverability blocks onboarding entirely… **never** self-host the MTA for verification mail"*, and `:1173`: *"Self-hosting an MTA is free software and expensive deliverability."*

**The zero-cost constraint is not the obstacle.** `MODERNIZATION_PLAN.md:2594` names Brevo (~300/day) as the largest free tier, and `ses`/`postmark`/`resend` are already drivers in `config/mail.php`. **The sending domain, the DNS records and bounce handling are the obstacle, and none exist:** a real `MAIL_FROM_ADDRESS` (it is `hello@example.com` today), SPF, DKIM, DMARC, bounce handling (zero hits for `bounce` in `api/app`), and a suppression list — which `MODERNIZATION_PLAN.md:1171`'s `List-Unsubscribe` mandate requires most of all for unsolicited mail.

**Recommendation: a prerequisite step 7.0 — Production email.** Pick a free-tier provider, set the production `.env`, publish SPF/DKIM/DMARC, add a bounce webhook and an `email_suppressions` table, and prove one real email reaches one real Gmail inbox. The schema and backend below can be built and tested against mailpit first; **the route must not be exposed in production until 7.0 lands.** §7.1 does not depend on this; this feature depends on it completely.

### §7.6C.2 ⚠️ A current security finding, independent of this feature

`ReviewInvited.php:40` pipes the speaker's free-text `invitation_message` straight into `->line(...)`.

Verified: the stock notification template renders `{{ $line }}` (Blade-escaped) and there is no repo override, **but** the result then runs through Markdown, where `Illuminate\Mail\Markdown` registers `CommonMarkCoreExtension` with `html_input => 'escape'` and `allow_unsafe_links => false`. Those two block raw HTML and `javascript:`/`data:` schemes — **they do not block CommonMark link syntax, and `[`/`]`/`(`/`)` are not escaped.** So `[Verify your account now](https://phish.example)` inside an invitation message renders as a **live clickable link in outgoing mail**.

Today that reaches only registered users a speaker explicitly named. **An email-invitation endpoint turns it into a relay for sending arbitrary clickable links to arbitrary addresses from your sending domain** — both an abuse vector and the fastest route to a blocklist.

**Fix, and it costs nothing:** don't put the message in the mail. The mail says "they left you a note; open the invitation to read it", and the note renders on the claim page as an inert text node. No escaping logic to get wrong, no behaviour lost — the recipient needs a reason to click anyway. ⚠️ **Worth fixing in `ReviewInvited` now, regardless of whether this feature ever ships.**

### §7.6C.3 The design: Option B, a `pending_invitations` table

My prior was B; it holds, for stronger reasons than the invariant argument alone.

**Where Option A is cleaner than the UX review assumed:** `reviews.reviewer_id` is **already nullable** (`BIGINT NULL … ON DELETE SET NULL`). The review's "make `reviewer_id` nullable" describes a change that is already done. That is the whole of A's advantage.

**And the strongest case *for* A, on the record because it nearly changed the answer:** `MODERNIZATION_PLAN.md:620-636` already made this exact call once, in the opposite direction — it *deleted* a separate pending-request table (`coaching_requests`) and folded invitations into `reviews` at `status='invited'`, arguing *"A directed invitation and the review it creates are keyed the same way, created together, transitioned together, and deleted together. They are one object."*

**Why A loses anyway, five verified reasons:**

1. **`reviewer_id IS NULL` is already a load-bearing sentinel meaning something else.** It means *the reviewer erased their account* — written unconditionally by `EraseSelfAccount.php:74` and `AccountErasureService.php:202`, and rendered as `'Former reviewer'` by `ReviewResource.php:67-73`. Under A, **every pending email invitation would render as "Former reviewer"** until a second sentinel is threaded through every one of those sites. And after erasure runs, an erased review and a pending invitation are **the same row shape**, distinguished only by a nullable text column — precisely the `nullable author_id` weakness `MODERNIZATION_PLAN.md:538` rejects, relocated from the author column to the grant column.
2. **The unique index gives A no protection and cannot be made to.** `CREATE UNIQUE INDEX uq_reviews_speech_reviewer ON reviews (speech_id, reviewer_id)` carries no `NULLS NOT DISTINCT` clause (Postgres 17 — it was available and not used), so **unlimited `(speech_id=X, reviewer_id=NULL)` rows are legal**. Two pending email invitations to the same address on the same speech would silently duplicate; so would five hundred. And it cannot be fixed by rebuilding the index, because the erasure design *requires* multiple NULLs per speech. A needs a **second** partial unique index expressing the same rule a different way on the same table.
3. **A's conversion is a hand-rolled merge inside a unique index; B's conversion *is* the existing idempotent upsert.** `ReviewService::invite()` is already the `lockForUpdate`-serialized three-branch upsert for "there may or may not already be a row", with 23 lines of docblock and a `$freshlyInvited` flag so a double-click doesn't re-notify. Under B, conversion calls it. Under A, conversion is an `UPDATE … SET reviewer_id = ?` that can violate the unique index whenever a row for `(speech, that user)` already exists — needing its own merge logic, locking and concurrency tests, duplicating `invite()`'s reasoning in a second place.
4. **The merge premise doesn't hold.** That argument rests on *"keyed the same way `(speech, reviewer)`"*. An email invitation is keyed `(speech, address)`, and an address **is not a reviewer**: it may never become one, may become two accounts over time, or may become someone other than the person the speaker meant.
5. **Retention is a `DELETE` under B and a destructive `UPDATE` on the permanent record under A.** Under A the purge must mutate `reviews` — the permanent record of every review ever held — and take care never to touch a row that has since converted.

**And `pending_invitations` is not `coaching_requests` returning.** That table was dropped because it modelled a **broadcast** — one row many coaches could claim, so one request produced N acceptances. A pending email invitation is 1:(0 or 1) and **converts into** the one row. It is a staging area with a 14-day lifetime, not a pool; nothing can discover it, and it names exactly one address.

**The framing that makes B consistent with the invariant rather than an exception to it:** the grant and the annotation set remain one row, always, and that row is still only ever created by `ReviewService::invite()` with a real `User`. `pending_invitations` is **a request to create a grant, addressed to a mailbox**, which expires unclaimed.

### §7.6C.4 The security core: convert at `Verified`, not `Registered`

> **The token does not authorize the grant. Proving control of the mailbox does.**

- **Convert at `Registered`** → the property is *"whoever types this email into the registration form first gets access to the speech."* A forwarded link, an email read over a shoulder, or a publicly-archived mailing list is enough. Nobody proves they control the mailbox.
- **Convert at `Verified`** → *"whoever controls this mailbox gets access"* — exactly the property the speaker intended when they typed the address, and no stronger claim is available.

Conversion matches on **email, not on the token**, so a recipient who deletes the mail and registers a week later converts anyway — correct behaviour, free from the design. The token's jobs are a deep link that shows who is asking and what for, a prefilled registration email, and a **decline** affordance for someone who will never register (courteous, and a deliverability requirement).

**A signed URL is the wrong tool.** It is stateless, so it cannot be revoked, marked claimed, rate-limited per token, or purged for GDPR. The invitation needs all four, so the link carries an opaque random token backed by a row — `password_reset_tokens`' shape (email-keyed, hashed, `created_at` for expiry) is the nearest precedent.

**Put the hook in an `Event::listen(Verified::class)` closure in `AppServiceProvider::boot()`, not in `CreateNewUser`.** Three reasons: the security one above; it **eliminates the §7.1 collision entirely** (that change edits `CreateNewUser::create()`; this one doesn't touch the file); and it matches the only event precedent in the repo — there is no `app/Listeners` directory and no `EventServiceProvider`, and the sole `Event::listen` is already a closure in `boot()`.

⚠️ **A logical ordering dependency remains even though the files differ:** `ReviewService::invite()` doesn't check roles, so conversion works either way — but a converted reviewer with **no role** won't appear in `scopeReviewerCandidates`, so the speaker couldn't later find them for a second speech. **Land §7.1 first.**

### §7.6C.5 Schema: one new table, zero changes to `reviews`

That is a design output, not an accident. Driver-branched raw `DB::statement` following the `data_exports` / `connections` template (the `status` CHECK cannot be acquired on SQLite outside CREATE TABLE).

Columns: `id`, `speech_id` (**CASCADE — load-bearing**, it is what makes account erasure sweep a speaker's sent invitations for free), `speech_owner_id`, `invited_by_id`, `email` (**nullable**, so the purge can clear it while keeping an audit stub — the `PurgeExpiredApplicationDocumentsCommand` pattern), `token_hash CHAR(64)` (SHA-256, not bcrypt: the lookup is *by token* and needs an indexable deterministic hash; the plaintext is emailed and never stored), `invitation_message`, `allow_preview`, `prior_commentary_shared`, `status`, `sent_at`, `expires_at`, `claimed_at`, `claimed_by_id`, `revoked_at`, `revoked_by_id`, timestamps.

Three CHECKs copying `ck_connections_blocked`'s `state <> X OR <required column> IS NOT NULL` shape. ⚠️ **Deliberately no `CHECK (email = LOWER(email))`** — `LOWER()` is ASCII-only on SQLite and locale-aware on Postgres, so the constraint would behave differently on the test driver than in production, the exact driver-parity bug class the `reviews` migration was amended to fix. Normalize in application code and pin it with a test.

Indexes: `uq_pending_invitations_speech_email … WHERE status = 'pending'` (partial, so a terminal row never blocks a re-invite — the `uq_annotations_review_client_uuid` idiom already proves partial unique indexes work on both drivers here), `uq_pending_invitations_token`, plus three lookup indexes for conversion, the roster and the purge.

⚠️ **The model needs a full hand-written `@property` docblock** — raw SQL defeats Larastan's column scanner. And `@property-read Speech|null $speech`: `Speech` uses `SoftDeletes` and the admin takedown path really does soft-delete one, the exact trap that produced two crash bugs recorded at `STEP-14-RETROSPECTIVE.md:50`.

### §7.6C.6 ⚠️ Email case-sensitivity will silently break conversion

`users_email_unique` is a **plain btree on `email`**, not on `lower(email)`, and Postgres `=` is case-sensitive. An exhaustive grep finds `strtolower`/`Str::lower` applied to usernames and a throttle key — **never to an email**. `CreateNewUser` validates uniqueness with no normalization.

**So `Coach@Example.com` and `coach@example.com` are two distinct users today**, and an invitation stored as typed would not match a signup typed differently. The identity migration's own comment is the warning: *"never rely on Postgres collation, which is case-sensitive by default"* — a discipline that exists for `username` and does not exist for `email`. Add one `App\Support\InvitationEmail::normalize()` helper used by the request, the service and the conversion hook.

### §7.6C.7 Abuse and privacy

**Enumeration.** Return **`202 Accepted` with `{"message": "Invitation sent."}`** for the email branch regardless of which internal path ran, and give the `email` rule **no `exists:`/`unique:`** (either is a free unlimited oracle via the 422 body) and no `email:dns` (network in tests, domain-level timing leak). ⚠️ **Honest caveat:** the speaker's own roster *does* disclose the difference on a later fetch — a registered invitee shows a name, a pending one shows an address. So the endpoint **is** an oracle, just an asynchronous, heavily rate-limited one: with the caps below, one account probes at most ~10 addresses/day, each needing an owned speech and a roster check. **The mitigation is the limiter, not the response shape.** Claiming the two responses are indistinguishable would be false.

**Spam — three limiters, not one.** `connection-request`'s per-pair cap is the stated precedent, but **per-pair alone is insufficient here**: it stops you pestering one person and does nothing to stop one account mailing a thousand distinct strangers. `connection-request` can afford that gap because it only reaches registered users. So: per-(inviter, address) 3/day, **per-inviter across all addresses 10/day and 5/hour**. ⚠️ `Limit::none()` when `email` is absent is **load-bearing** — without it the limiter also throttles the directory path and breaks `MODERNIZATION_PLAN.md:2274`'s "invites two Coaches and one other Member" acceptance criterion. ⚠️ Returning an **array** of limits is documented Laravel behaviour but has **no precedent in this repo** (all six existing limiters return a single `Limit`) — verify against the installed version; the fallback is two `throttle:` middlewares.

**GDPR.** Lawful basis is narrow legitimate interest — the speaker instructed us to contact one named person about one specific thing — and it does not survive expiry, which is why retention is short and automatic:

> A pending invitation expires **14 days** after creation; `email` is nulled the moment the row goes terminal; the terminal row is hard-deleted **30 days** after that.

Nulling first and deleting later is deliberate: a recipient who clicks twice gets a deterministic "no longer active" for a month while the personal data is already gone. New `invitations:purge-expired` command with a `--force-age=` flag, scheduled with the **same e2e-every-minute / else-daily split** all four existing commands use.

⚠️ **The erasure hook must land in the same commit as the table, and there is proof.** `AccountErasureService.php:205-211` still reads: *"connections: STEP-13 (social layer) has not shipped yet… When STEP-13 lands, add the hard-delete here — **do not silently forget it**."* **STEP-13 shipped** — the migration and `ConnectionService` both exist — **and a grep for `Connection` in that service returns nothing.** It was silently forgotten, exactly as its own comment feared. That is a **live privacy gap today, independent of this feature** (see §15).

⚠️ **Residual gap, flagged not solved:** a person invited who never registers cannot log in to exercise access or erasure. The honest answer is a documented manual operator query; the 14-day expiry is what keeps it small.

### §7.6C.8 ⚠️ `allow_preview` is stored and read by nothing

Eight hits across `api/app`, **all plumbing** — model, resource, request, controller, service. **No policy, no controller gate, no query reads it.** `SpeechController::show` serves the reduced metadata tier to *any* `invited` reviewer regardless of its value. So it is a declared intention with **zero enforcement site**, and any design that leans on it is leaning on nothing. Build the claim page's preview tier (speaker name, speech title, message; **no playback URL, no duration, no poster**) independently of it. ⚠️ Whether that is a deliberate deferral or an unnoticed gap is recorded nowhere.

### §7.6C.9 The handoff to §7.2

§7.2 builds the roster on the same screen; pending-email rows must render there. **Four things that are not obvious:**

1. **There is no `review.id`** — every action keys on `PendingInvitation.id` against a different endpoint. §7.2's roster cannot assume one id space.
2. **The action is "Cancel invitation", not "Revoke".** No grant to revoke, no bytes to purge, no `revocation_reason` — so **§7.2's revoke-with-mandatory-reason dialog must not be reused for these rows.** Different verb, different copy, different endpoint. Offer **Resend** alongside (an idempotent re-POST refreshing `expires_at` and re-minting the token).
3. **Group them separately.** A pending email invitation and an `invited` on-platform review look alike and behave completely differently; collapsing them invites a speaker to click Revoke on something that cannot be revoked.
4. **Two endpoints, not one.** §7.2's opt-in surfaces `invited` *reviews*; pending email invitations are not reviews and are not in that table. Two fetches, two cache tags, one rendered list. **Agreeing this before either is built is cheaper than reconciling it after.**

A pending-email row is: **an address, a status, a clock, and two actions.** No profile, no avatar, no credential badge — the avatar slot takes a typographic initial placeholder, the convention the repo already uses for a missing poster ("a designed state, not a broken image").

In `InviteReviewerPanel`, the directory block must be hidden with the `hidden` attribute, **not conditionally unmounted** — the same reasoning as `keepMounted`: unmounting destroys the search text, filter and page that the panel deliberately preserves even across a successful send.

---

# Part III — Cross-cutting

## §12 The frozen accessible-name contract

Renaming or adding an `aria-label` updates `vitest` and **silently breaks Playwright**. This has bitten this repo before. Playwright's `getByRole(name:)` defaults to **substring, case-insensitive** matching — the specs add `exact: true` only to disambiguate (`Password` vs `Confirm password`; `Publish`). So **extending** an accessible name is safe; **replacing, splitting or reordering** it so the original substring disappears is not.

| Label | Source | Asserted by | Touched by |
|---|---|---|---|
| `Choose commentary track` (radiogroup) | `TrackSelector.tsx:77` | `two-users.spec.ts:119`, `voice-annotations.spec.ts` ×6 | §7.4 |
| the chip's name = the reviewer's name | `TrackSelector.tsx` | `two-users.spec.ts:102-103` | §7.4 — **append only** |
| row name = `"Annotation at 0 seconds "` + body | `Transcript.tsx:141-142` (**a two-span concatenation**) | `voice-annotations.spec.ts:56,366,373,404` | §7.7 — **the most brittle contract in the repo.** Adding *anything* to that row's name breaks four assertions |
| `Commentary transcript` (ol) | `Transcript.tsx:118` | `voice-annotations.spec.ts:369,399,460` | §7.7 — ⚠️ rendering a second instance on the authoring screen risks a **strict-mode violation** |
| `Record a voice note` (region) | `VoiceRecorder.tsx:166` | `voice-annotations.spec.ts` ×4 + cross-browser | §7.7 |
| `Speech tools` (owner tablist) | `SpeechWatch.tsx:406` | `captions.spec.ts` ×7, `essay-editor.spec.ts:713`, `SpeechWatch.test.tsx:408` | §7.2 adds a *section* to a panel, not a tab — safe |
| `Your feedback` (reviewer tablist) | `SpeechWatch.tsx:488` | `captions.spec.ts:440,604`, `essay-editor.spec.ts:636` | §7.2, §7.7 |
| `Main` (nav) | `AppSidebar.tsx:34` | 6 sites across 4 specs | — |
| `Skip to content` | `AppLayout.tsx:30` | `app-shell.spec.ts:74` | §7.7 |
| `Watch` (link, **scoped inside `[data-slot="card"]`**) | `MySpeeches.tsx` | `captions.spec.ts:489-490` | §7.5 — ⚠️ put the owner menu in `CardHeader`, and introduce no nested `data-slot="card"` |

**Change none of these. Grep `web/tests/` for every new string.** New labels are additions, not renames — low risk, but grep anyway.

## §13 Cross-feature seams

| # | Seam | Resolution |
|---|---|---|
| **1** | **§7.2 and §7.4 both want `annotations_count` on the wire.** They are real `SMALLINT` counter-cache columns, not aggregates, so there is no N+1 question (C5) | **§7.2 adds them, on its own new roster resource only; §7.4 consumes them.** Keep them off `ReviewResource`, which five other consumers share and where a drifted counter has no reader. Precedent for exposing exists — `ProfileTimelineController.php:114` already emits one as `notes_count`. ⚠️ **Sequence §7.2 before §7.4.** And never gate authorization on them |
| **2** | **§7.1 and §7.6C both wanted `CreateNewUser.php`** | Dissolved: §7.6C's hook moves to an `Event::listen(Verified::class)` closure, so **it never touches that file**. A *logical* dependency remains — land §7.1 first, or a converted reviewer with no role is invisible in the directory for their next invitation |
| **3** | **§7.5 must revoke live grants when a speech is deleted** | It must **not**. The SoftDeletes global scope already excludes the speech before any grant is consulted, so the soft delete *is* the revocation; writing `revoked_at` would be semantically false to the coach and would permanently break admin-restore (§7.5.4). **If §7.5's diff touches `reviews`, it has left its plan.** If a future variant ever does need per-grant revocation, it must loop `ReviewService::revoke` — never a bulk `UPDATE`, which would skip every audit entry and notification §7.2 adds |
| **4** | **§7.6C's pending rows must render in §7.2's roster** | §7.6C.9. The load-bearing point: **§7.2's revoke dialog must not be reused** for them — different verb, no reason field, different endpoint. Build §7.2's roster list as a discriminated union (`kind: 'review' \| 'pending'`) from day one even though only one variant exists, because retrofitting that into a `Review[]` type and a status-grouping switch is strictly more work later |
| **5** | **§7.7 and §7.2/§7.4 all touch the annotation surfaces' labels** | §12. §7.7 is the one that must change existing names; the other two only add |
| **6** | **§7.3 and §7.6C both build notifications** | No conflict, but §7.3's `frontendUrl()` helper is what §7.6C's mail needs. **Land §7.3 first and §7.6C reuses it** rather than introducing a second way to build a frontend link |

## §14 What nobody verified

Honest ledger. Nothing in this document was executed — no `pest`, no `phpstan`, no `tsc -b`, no migration, no container. Every claim is read from the working tree at `8b142c4`, except four read-only `SELECT`s against the running Postgres (noted in §7.6C).

1. **Whether the suite is currently green.** The last recorded state predates `8b142c4`.
2. **Whether production sets `MAIL_*` at all** — the provisioning script lives in a sibling repo. ⚠️ If it already configures a real mailer, §7.6C's prerequisite drops from "blocker" to "verify SPF/DKIM/DMARC and bounce handling". It would not go to zero.
3. **"The three flagship endpoints"** are never enumerated anywhere. §7.7.8's mapping is inference from the three *screens* STEP-15 names.
4. **Whether `C` is meant as a bare key or a chord.** Both source documents say "inside the textarea", which is unimplementable as a bare key. §7.7.6's recommendation is reasoned, not cited.
5. **Whether WCAG 2.2 2.5.7 currently passes** via the row editor's nudge buttons as an "Equivalent" exception. Leaning *passes, with poor discoverability* — needs a conformance judgement, not a grep.
6. **Base UI non-modal popover:** whether it returns focus to the trigger and closes on `Esc` in the installed 1.7.0. The docblocks assert it; `PLAN-APP-HEADER.md:740` still lists it as an unmet precondition; `aria-haspopup` appears only in a comment, never as an attribute. *(The `TabsPanel` half of this item is now **resolved** — see §7.7.1: it unmounts by default, and only one panel in `SpeechWatch` opts out.)*
7. **Current Axe violation counts and the Lighthouse score.** Zero tooling installed, so every §7.7 gap is a static-reading finding, not a measured one.
8. **Whether an array-returning `RateLimiter::for` closure works on the installed Laravel.** Documented behaviour, no precedent here.
9. **Whether `buildAccountExport` also needs `withTrashed()`** — the owner's *own* export may silently omit their removed-but-unpurged speeches. Flagged in §7.5.6, not resolved.
10. **Whether `revokeAndPurge`'s `PurgeVoiceAsset` dispatch survives the row delete it races.** The job looks the asset up by id, so it should not need the review — but whether the cascade takes the `speech_assets` row with it was not traced end to end. **If it does, the bytes leak.** `media:reconcile` is the stated backstop, but that is a migration comment, not a verified path.
11. **Mailpit's HTTP API for reading mail in Playwright.** Exposed and healthchecked, but no test reads mail today; §7.6C's e2e test is new ground and may need a spike.
12. **Free-tier email provider limits** are quoted from an August 2026 document. Re-check before committing to one.

## §15 ⚠️ Two live bugs found while planning, unrelated to any of the ten items

Both are current defects in shipped code. Neither belongs to a plan above; both are small.

**(a) Account erasure never purges `connections` — a live privacy gap.** `AccountErasureService.php:205-211` carries a comment saying *"When STEP-13 lands, add the hard-delete here — do not silently forget it."* STEP-13 landed: `2026_08_30_100001_create_connections_table.php` and `ConnectionService.php` both exist. A grep for `Connection` in that service returns **nothing**. So erasing an account leaves its connection rows behind, and the dry-run `plan()` cannot report what `execute()` does not do. This is exactly the failure its own comment predicted, and it is the strongest available argument for landing §7.6C's erasure hook in the same commit as its table.

**(b) The Markdown link relay in `ReviewInvited`.** §7.6C.2. Worth fixing now regardless of whether email invitations are ever built — today it reaches only people a speaker named, which is a much smaller blast radius, but the fix is to stop putting free text in the mail body and costs nothing.

---

## Appendix — one-line summary per item

| Item | Plan needed? | Shape | Blocked by |
|---|---|---|---|
| §7.1 member role | no | 2 files + backfill + 1 test. Zero test breakage (C7) | — |
| §7.2 roster + revoke | **re-scoped here** | 1 new endpoint, 1 resource, 4 audit writes, 1 notification, 2 components | — |
| §7.3 notification layer | no | 1 new class + 1 url helper + 4 dead links + 3 missing bell cases | — |
| §7.4 feedback visible | no | 1 default, badges, localStorage | §7.2 (seam 1) |
| §7.5 speech edit/delete | **here; design reversed** | soft delete, 1 nullable column, 1 service, the export fix | — |
| §7.6C invite by email | **here** | 1 new table, 1 service, convert at `Verified` | ⚠️ **step 7.0, production email** |
| §7.7 keyboard + a11y | **= STEP-15, here** | 1 hook, roving tabindex, 1 one-line WCAG fix, **1 `keepMounted`**, Axe baseline **first** | Axe baseline; 2 criteria need descoping |
| §7.8 quota | no | 3 resource fields + a meter + split one error | — |
| §7.9 landing page | no | 1 file | — |
| §7.10 audit browser | no | 1 read-only Filament resource. **No migration** (C6) | — |
