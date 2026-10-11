# UX Review — Roles, Tasks, and Perceived Effectiveness

**Date:** 2026-10-10
**Branch:** `development` (at `8b142c4`)
**Reviewer scope:** the *shipped* application — `api/` and `web/` as they exist in the working tree. Plans were read for context, but nothing in this document credits a feature to the product because a plan describes it.
**Method:** every claim below is cited to a file and line and was read directly. Where a finding is already known to an existing plan document, that plan is named so credit and status are not confused.

---

## 0. One-paragraph verdict

This is an unusually well-engineered application wrapped around a product loop that **a real new user cannot currently complete**. The security model, the media pipeline, the annotation engine, and the admin panel are all of genuinely professional quality — better than most shipped SaaS. But the connective tissue between the four roles is thin: a self-registered user is invisible in the only directory the product has, the speaker is never told when their feedback arrives, and the central promise on the README's front page — *"Nobody sees your speech unless you personally invited them"* — has **no un-invite button anywhere in the interface**. The engineering is ahead of the product. Closing that gap is mostly small frontend work against endpoints that already exist, plus one three-line backend fix that is currently blocking everything else.

---

## 1. The four roles, and what each can actually do today

Four roles exist exactly (`api/database/seeders/RoleSeeder.php:23`): `super_admin`, `admin`, `coach`, `member`. A fifth, unnamed state matters more than any of them: **`roles: []`**, which is what every self-registered account actually has (`api/app/Actions/Fortify/CreateNewUser.php:41` creates the user and assigns nothing).

| Task | `roles: []` (real new user) | `member` | `coach` | `admin` | `super_admin` |
|---|---|---|---|---|---|
| Register, verify email, onboard (3 steps) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Upload a speech, get poster/sprite/captions | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit or delete a speech afterwards | ❌ **no route exists** | ❌ | ❌ | takedown only | takedown only |
| Browse the reviewer directory | ✅ (returns **nothing** — §2.1) | ✅ | ✅ | ❌ by design | ❌ by design |
| **Appear** in the reviewer directory | ❌ **never** (§2.1) | ✅ | ✅ | ❌ by design | ❌ by design |
| Invite a reviewer to a speech | ✅ | ✅ | ✅ | ❌ by design | ❌ by design |
| See who they invited / revoke access | ❌ **no UI** (§2.2) | ❌ | ❌ | — | — |
| Accept / decline an invitation | ✅ | ✅ | ✅ | ❌ by design | ❌ by design |
| Write timestamped notes, essay, publish | ✅ | ✅ | ✅ | ❌ by design | ❌ by design |
| Record **voice** notes | ❌ coach-only | ❌ coach-only | ✅ | ❌ | ❌ |
| Withdraw / abandon a review once accepted | ❌ **no UI** (§2.2) | ❌ | ❌ | — | — |
| Request connections, see profile timeline | ✅ | ✅ | ✅ | ❌ by design | ❌ by design |
| Export own data, delete own account | ✅ | ✅ | ✅ | ✅ | ✅ |
| Apply to be a coach | ✅ | ✅ | n/a | ❌ by design | ❌ by design |
| Resolve/dismiss reports | ❌ | ❌ | ❌ | ✅ | ✅ |
| Approve/reject coach applications | ❌ | ❌ | ❌ | ✅ | ✅ |
| Take down / restore a speech, purge media | ❌ | ❌ | ❌ | ✅ | ✅ |
| Suspend / unsuspend / soft-delete a user | ❌ | ❌ | ❌ | ✅ | ✅ |
| Grant or revoke **admin / super_admin** | ❌ | ❌ | ❌ | ❌ | ✅ |
| Erase or demote a user | ❌ | ❌ | ❌ | ❌ | ✅ |

The authorization model behind this table is excellent and I want to say so before criticising anything else. `Gate::before` is a *scoped* admin bypass with an explicit `$mustFallThrough` list (`api/app/Providers/AppServiceProvider.php:300-381`), so "coaching is an act, not an admin power" is enforced structurally rather than by convention. An admin genuinely cannot write an essay on someone's speech. That is rare and correct.

---

## 2. The speaker — the person who needs coaching

This is the persona the product exists for, and the one whose journey breaks first.

### 2.1 🔴 The directory a new speaker is sent to is empty, permanently

The product has exactly one way to find a reviewer. `ReviewerDirectory.tsx:66` says so in its own copy: *"no open pool, this is the only way to find them."*

That directory is backed by `User::scopeReviewerCandidates`, which opens with:

```php
$query->role(['member', 'coach']);          // api/app/Models/User.php:86
```

And registration assigns no role at all:

```php
return User::create([                        // api/app/Actions/Fortify/CreateNewUser.php:41
    'email'    => $input['email'],
    'password' => Hash::make($input['password']),
]);
```

`grep -rn "assignRole\|syncRoles" api/app api/database` finds the role being assigned in exactly three places: `RoleAssignmentService` (an admin acting in the panel), `GrantRoleCommand` (the CLI), and `CoachApplicationDecisionService:30` (coach approval). **Nothing in the registration path.**

The consequence, in a fresh deployment with no seeder:

- An approved coach **does** appear (approval assigns `coach`).
- An ordinary peer **never** appears. The directory's "Members" filter is permanently empty.
- Until the first coach application is approved by hand, the directory is empty full stop — and the speaker's only discovery surface reads *"No reviewers found."* with no explanation.

This is why I rank it first: it is not a polish issue, it is the product's core loop failing closed. It is also a three-line fix (§4.1).

> Not previously documented as a bug. `PLAN-POST-ONBOARDING-UX.md` F3 correctly observes *"real self-registered users have `roles: []`"* — but draws a frontend conclusion from it (don't build a positive allowlist in nav) and does not connect it to the directory query.

### 2.2 🔴 There is no way to un-invite anyone

The README's headline rule is *"Nobody sees your speech unless you personally invited them."* The backend honours it completely: `POST /reviews/{review}/revoke`, `/revoke-and-purge`, `/withdraw`, `/abandon` all exist (`api/routes/api.php:207-213`), with a service, a policy, an audit trail, and a byte-purge path for voice notes.

In the interface:

- `useRevokeReviewMutation`, `useWithdrawReviewMutation`, `useAbandonReviewMutation` are exported at `web/src/features/review/reviewApi.ts:138-140` and have **zero call sites** anywhere in `web/src`.
- `revoke-and-purge` has no frontend binding at all — `grep -n "revokeAndPurge\|revoke-and-purge" web/src/features/review/reviewApi.ts` returns nothing.
- `grep -rn "Revoke\|Withdraw\|Abandon" web/src --include="*.tsx"` (excluding tests) returns only `URL.revokeObjectURL` and the coach-application `withdrawn` badge.

So the single most important control in the product — *take my face back* — is reachable only by an admin in Filament, or by deleting your entire account. A speaker who invites the wrong person, or falls out with a coach mid-review, has no self-service remedy.

> Known. `PLAN-WATCH-REVIEWERS-TAB.md` §4.2 proposes the roster that would house these buttons; §10.2 confirms the mutations are still callerless. It is a proposal, not shipped.

### 2.3 🟠 The speaker is never told their feedback is ready

`ReviewService` fires three notifications — invite, accept, decline (`api/app/Services/ReviewService.php:137, 191, 216`). `publish()` at `:407` fires **none**. There is no `ReviewPublished` class in `api/app/Notifications/`.

So the sequence a speaker actually experiences is:

1. "Cora accepted your invitation on *Best Man Speech*." ✅ notified
2. …Cora watches it, writes eleven timestamped notes and a 600-word essay, presses **Publish**.
3. Silence. No email, no bell, no badge.

The payoff moment of the entire product is the one event it does not announce. The speaker finds out by chance, the next time they happen to open the speech and click a chip.

### 2.4 🟠 …and when they do open it, the feedback is hidden by default

`useCommentaryTrack.ts:66` initialises the selection to `NO_COMMENTARY`. The track chips (`TrackSelector.tsx:77-99`) render the reviewer's name and nothing else — no status, no note count, no "new" marker.

A speaker with three reviewers therefore opens their speech to a player showing no annotations at all, and must click each chip in turn to discover which of the three has actually written anything. Two reviewers who accepted but have written nothing are indistinguishable from the one who published eleven notes until you click them.

The data to fix this is almost entirely on the wire already: `ReviewResource` carries `status`, `first_published_at` and `last_published_at` (`api/app/Http/Resources/ReviewResource.php:26-36`). The counts exist on the model but are deliberately not serialised — `web/src/features/review/types.ts:14` notes this explicitly.

### 2.5 🟠 The speaker cannot see pending invitations for a speech

`ReviewController::forSpeech` filters to `Review::ACCESS_GRANTING` and excludes revoked rows (`api/app/Http/Controllers/Api/ReviewController.php:202-203`), i.e. `accepted`, `in_progress`, `published` only. An `invited` row — someone asked but hasn't answered — can never reach the frontend.

There is also no screen that would render it. The `Reviewers` tab contains the invite composer and nothing else (`SpeechWatch.tsx:476-482`). So *"did I already ask Cora, or did I only think about it?"* is unanswerable in the app.

> Known and correctly scoped. `PLAN-WATCH-REVIEWERS-TAB.md` §10.2 is explicit that this one needs a backend change, not just a component.

### 2.6 🟠 A speech, once uploaded, is permanent

`api/routes/api.php` registers `GET /speeches`, `POST /speeches`, `GET /speeches/{speech}` — and `SpeechController` has exactly three methods: `index`, `store`, `show`. There is **no** `PATCH` and no `DELETE`.

So a speaker who uploads the wrong file, typos a title, or simply wants an old speech gone has three options: leave it, report their own speech to an admin, or delete their entire account. For a product whose content is *video of the user's own face and voice*, with a privacy promise as its headline feature, that is the weakest part of the trust story — and arguably a data-minimisation problem under GDPR Art. 17, which `MODERNIZATION_PLAN.md` §11.1 flags as still unaddressed.

### 2.7 🟡 Smaller speaker-side friction

- **Notifications are not links.** `NotificationBell.tsx:91` — clicking a notification calls `markRead` and nothing else. *"Cora invited you to review X"* → click → the text changes weight. The user must then find `/dashboard` themselves.
- **Quota is invisible until it bites.** 5 GiB and a hard limit of 2 concurrent uploads are enforced atomically in `QuotaService` (`:77-78`), surfaced only as the validation string *"This upload would exceed your storage quota, or you already have 2 uploads in progress."* `grep -rn "quota\|storage" web/src --include="*.tsx"` finds no UI anywhere. The user learns the rules by breaking them.
- **The logged-out landing page is a developer stub.** `web/src/routes/Home.tsx:5` — *"Frontend foundation is up."* Nothing explains the product, and there is no link to register.
- **The Essay tab depends on a choice made in a different tab.** `EssayReadOnlyPanel` is driven by `useCommentaryTrack`'s selection, so a speaker who opens Essay first sees *"Pick a reviewer to see their essay"* with no reviewer picker on that tab (`SpeechWatch.tsx:431-437`, `EssayReadOnlyPanel.tsx:29-31`). The empty state is honest; the coupling is still confusing.

### Speaker verdict

**Where it's strong:** upload-to-playback is excellent. Posters, a 10-frame sprite scrubber, automatic Whisper captions, a caption editor, signed-URL refresh mid-playback, honest per-state error copy (`SpeechWatch.tsx:233-271` distinguishes 403/404/network rather than hanging on a spinner — a genuinely uncommon level of care). Voice notes that pause the video and resume are a real differentiator.

**How effective it will feel:** **3/10 today, 8/10 after §4.1–§4.5.** The quality is all present but sits behind a loop the user cannot start and a payoff the product does not announce. The most likely real-world outcome right now is that a new user uploads one speech, finds nobody to invite, and never returns.

---

## 3. The coach / reviewer

### 3.1 The authoring surface is the best thing in the product

`AnnotationComposerPanel.tsx` is genuinely strong work:

- A live overlay preview merged from saved rows *and* unsaved drafts through one `useTimedAnnotations` instance (`:130-133`) — not two engines that can disagree.
- `TimelineStrip` for drag-to-retime, with its own error toast.
- **"Pause on first keystroke"** (`:190-197`) — a persisted per-user preference. This is the single best UX decision in the codebase. Somebody understood that typing while a video runs loses you the moment you were typing about.
- A voice recorder with waveform preview, a transcript, retry, and restore.
- A volume warning that fires at >6 voice notes, naming the total seconds of interruption it will cost the speaker (`:228-232`). That is design empathy for the *other* person in the transaction, which almost nothing does.
- Publish reports what it published: *"Published 11 notes"*, plus the §6.11 notice that the speaker may later show it anonymised to a reviewer of a newer version (`:159-171`).

### 3.2 🟠 The coach cannot get out of a commitment

Same root as §2.2, other side of the table. A coach who accepts an invitation and then can't do it has no **Withdraw**, and one who starts and stalls has no **Abandon**. The review sits in the speaker's "In progress" forever. Both endpoints exist; both are unreachable.

### 3.3 🟠 "Published" is one-way and all-or-nothing

`publish()` stamps `published_at` on every unpublished annotation in the set (`api/app/Services/ReviewService.php:413-416`). There is no unpublish, no per-note hold-back, and no "publish these three now, the rest when I'm done." For feedback on someone's personal performance, the absence of an undo on an irreversible, emotionally-loaded send is a real anxiety cost.

### 3.4 🟡 Repetitive work has no shortcuts

`grep -rn "onKeyDown\|addEventListener('keydown')" web/src` finds keyboard handling in exactly one hook — `useVoiceInterjections.ts:252`. There is no `J`/`L` seek, no `C` to stamp a timestamp, no `[`/`]` to jump between notes. `STEP-15-accessibility.md` specifies that whole keyboard map, and STEP-15 has not been built. A coach writing 30 notes across a 10-minute speech does every one of them mouse-first.

### 3.5 🟡 No structure, so no comparability

Feedback is free text plus a free-text essay. There is no rubric, no criteria, no score, no tags. Two consequences:

- Coaches have no scaffold, so quality varies with the individual.
- Nothing is comparable across reviews or across versions, so the product cannot answer *"am I getting better?"* — even though `supersedes` chains, `ArcStrip` version history, and `prior_commentary_shared` already exist to carry exactly that answer.

### Coach verdict

**How effective it will feel:** **7/10.** A coach who gets an invitation will enjoy the tools — the authoring surface is better than most dedicated video-review products. What they won't get is a way to decline gracefully once committed, an undo on publish, or any keyboard efficiency. And since the directory doesn't list them until an admin approves a coach application, most coaches will never receive a first invitation at all.

---

## 4. The admin

Mounted at `/control-panel` (never `/admin`), Filament 4, mandatory TOTP with recovery codes, and — as of `8b142c4` — a real session-stamp MFA check rather than vendor's enrolment-only check (`AdminPanelProvider.php:132`).

**What works well:**

- A two-tile moderation-queue dashboard (open reports, coach applications waiting) that deliberately ships **no migration** because both counts ride existing indexes (`ModerationQueuesWidget.php:28-37`). That reasoning — don't buy seven indexes for a 15-row table — is the right instinct.
- Five resources: Users, Speeches, Reports, Coach Applications, Connections.
- Mandatory reason text on every destructive action, written to an append-only `audit_log`.
- A per-user history panel sourced from `audit_log` rather than from a `suspended_by_id` column that would have to be kept honest (`ViewUser.php:334-384`).
- `CheckUserIsActive` placed deliberately *before* `AuthenticateSession` in the panel middleware, with a 40-line comment explaining why Laravel's `$middlewarePriority` map — not declaration order — decides it, and what the bug was when it sat downstream (a suspended admin got a bare 403 **and kept a live session**). This is the best piece of defensive documentation in the repository.

**Gaps:**

- 🟡 **No global audit log browser.** `audit_log` is readable only as the last 50 rows for one user on `ViewUser` (`:365`). An admin cannot answer *"what happened on the platform this week?"* or *"what has admin X been doing?"* without SQL. For the one table whose entire purpose is accountability, that is an odd place to stop.
- 🟡 **Reports are the only inbound signal.** The queue is reactive — somebody must file a report. There is no flag for stuck transcodes, failed caption jobs, or users sitting at their quota ceiling. `ModerationQueuesWidget`'s own docblock names the two most-wanted tiles ("new users this week", "stuck transcodes") and explains they were cut because they'd each need a migration. That trade is defensible now; it won't be at 1,000 users.
- 🟡 **Role granting is the de facto fix for §2.1.** Until registration assigns `member`, an admin must hand-grant a role to every user who should be visible in the directory. Nothing in the panel tells them that, so they won't know to do it.

### Admin verdict

**How effective it will feel:** **8/10.** Everything an admin is *asked* to do, they can do, safely, with an audit trail and a reason. What's missing is proactive visibility — they can respond to the platform but can't observe it.

---

## 5. The super-admin

The super-admin holds exactly four abilities nobody else does: `user.erase`, `user.demote`, `role.grantSuperAdmin`, `role.revokeSuperAdmin` (`AppServiceProvider.php:252-255`). These are the only abilities in the system where the two administrative tiers diverge — everything else collapsed onto `Role::ADMIN_TIER` in `PLAN-ADMIN-DASHBOARD.md` §5.2.

**What works well:**

- The four abilities stay in `$mustFallThrough`, so a plain admin gets `false` from the policy rather than `true` from the blanket bypass — and the comment at `:348-352` explicitly flags that this is "the load-bearing half" and the easiest block in the file to delete by mistake. Correct, and correctly annotated.
- `wouldOrphanAdminRoster` (`RoleAssignmentService.php:157`) prevents removing the last admin.
- Documented break-glass: `php artisan user:grant-role` bypasses both the Gate hook and the service (`AppServiceProvider.php:295-298`).
- Recovery codes are enabled deliberately, because role management lives *inside* the panel — so an admin who loses their phone cannot be restored unless another admin already exists (`AdminPanelProvider.php:110-123`). That failure mode was reasoned about before it happened.

**Gaps:**

- 🟡 **The role is almost invisible.** A super-admin's UI is an admin's UI plus two conditionally-rendered buttons on the user table. There is no "who holds elevated access" roster, no "when did someone last use a super-admin power" view. The one role whose job is overseeing the others has no oversight surface.
- 🟡 **Known hole, documented:** a *suspended* admin signing in is still escorted cross-origin to the panel, because `CheckUserIsActive` runs before the login controller and `UserResource` carries no suspension state (`web/src/lib/roles.ts`, `getPostLoginDestination` docblock). They land on a bare Blade suspension page with no way back. The comment is right that closing it properly needs a backend contract change — but it's a two-field addition, not a redesign.

### Super-admin verdict

**How effective it will feel:** **7/10.** Safe, well-reasoned, and correctly minimal — but with no reflective surface of its own, it's an administrative tier you have to read the source to understand.

---

## 6. Overall effectiveness

| | Score | One-line reason |
|---|---|---|
| Speaker (needs coaching) | **3 → 8** | Loop can't start; payoff isn't announced. Everything else is ready. |
| Coach / reviewer | **7** | Best-in-class authoring tools; no graceful exit, no undo, no shortcuts. |
| Admin | **8** | Can respond to anything; can observe almost nothing. |
| Super-admin | **7** | Correct and safe; invisible. |
| **Engineering quality** | **9** | Authorization, media pipeline, error states, and the documentation of *why* are all well above typical. |

The honest summary is that this project is **two or three weeks of frontend work away from being genuinely good**, and that the gap is not where the effort has gone. Fifteen vertical slices built the hard parts — multipart upload, transcode queue, signed URLs, a cue-timing engine, Whisper captions, RBAC with a scoped bypass, Filament with real MFA. What's missing is the ordinary glue: a role on registration, four buttons, one notification class, one query parameter.

A user would not perceive this as an unfinished prototype. They would perceive it as a polished product that mysteriously has nobody on it and never tells them anything.

---

## 7. Suggested improvements

Ordered by *(user impact) ÷ (work required)*. Each carries two explanations and a concrete change list.

---

### 7.1 Assign the `member` role at registration 🔴 **Do this first**

> **For a ten-year-old:** Imagine a club where you have to be wearing a badge to show up in the members' book. When someone new joins, nobody gives them a badge. So when you open the book to find a friend to help you, the book is empty — even though lots of people have joined. We just need to hand out a badge at the door.

> **The detailed version:** `User::scopeReviewerCandidates` restricts the directory to `->role(['member', 'coach'])` (`api/app/Models/User.php:86`) because §7.1 of the plan requires that an admin can *never* appear as a reviewable candidate — categorically, regardless of filters. That restriction is correct. But `CreateNewUser::create()` (`api/app/Actions/Fortify/CreateNewUser.php:41`) persists a user with no role, so every self-registered account fails the `whereHas` that scope generates. The result is that the product's *only* discovery mechanism (`ReviewerDirectory.tsx:66` — "this is the only way to find them") returns an empty set for ordinary users, permanently. Approved coaches are the exception, because `CoachApplicationDecisionService:30` assigns `coach` on approval. So the directory's "Members" filter is dead, and the whole directory is dead until the first coach is approved by hand. The cold-start problem the no-open-pool design already has is made absolute by it.
>
> Note the ripple: `web/src/lib/roles.ts` is deliberately written so that `roles: []` is the *normal* case and nav is additive-only. That design stays valid — it just stops being load-bearing. Do **not** "simplify" it afterwards; it is the right defensive shape.

**What would need to change:**

| File | Change |
|---|---|
| `api/app/Actions/Fortify/CreateNewUser.php` | After `User::create([...])`, call `$user->assignRole(Role::MEMBER)` and return `$user`. Use `assignRole`, **not** `syncRoles` — `RoleAssignmentService.php:55-62` documents why `syncRoles` is the wrong verb (it replaces, and has caused a real bug here). |
| `api/database/migrations/` | One backfill migration: `member` for every existing user with no role and `anonymized_at IS NULL`. There are ~15 users, so cost is nil. |
| `api/app/Models/User.php` | **Add `->whereNotNull('username')` to `scopeReviewerCandidates`, in the same commit.** `first_name`/`last_name`/`username` are all nullable and populated only at onboarding step 1 (`2026_08_07_004005_add_identity_columns_to_users_table.php:24-30`), and `ReviewerDirectoryResource` renders `trim("{$first_name} {$last_name}")` — so a user who registers and never onboards would otherwise become a blank, invitable directory row with a `Member` badge and an `@` with nothing after it. A user with no username also has no resolvable `/u/{username}` profile, so they are not addressable as a reviewer in any case. |
| `api/app/Services/RoleAssignmentService.php` | Nothing — this is a system act at account creation, not an admin act, so it correctly bypasses the service (same exemption `CoachApplicationDecisionService` documents). Add a one-line comment saying so, or the next reader will file it as a violation of the "never call `assignRole()` directly" rule. |
| `api/tests/Feature/` | One assertion that a freshly registered user holds `member` and appears in `scopeReviewerCandidates`. |

**Risk:** low. The only behaviour that changes is directory visibility, which is currently broken. Watch for tests that assert `roles: []` on a new user — `grep -rn "roles.*\[\]" api/tests web/src` before committing.

---

### 7.2 Build the reviewer roster, with revoke 🔴

> **For a ten-year-old:** You lent your diary to three friends so they could write nice notes in it. Right now there's no list of who has it, and no way to ask for it back. You'd have to burn the whole diary. We should add a list with a "please give it back" button next to each name.

> **The detailed version:** The product's headline guarantee is consent-based access. The backend implements it fully — `revoke`, `revoke-and-purge`, `withdraw`, `abandon`, each with a service method, a policy, an audit entry, and a voice-note byte purge. The frontend implements none of it: the three hooks at `web/src/features/review/reviewApi.ts:138-140` have zero call sites, and `revoke-and-purge` has no binding at all. A guarantee the user cannot exercise is a guarantee in the changelog, not in the product. The second half of the gap is observability: `ReviewController::forSpeech` filters to `Review::ACCESS_GRANTING` (`:202`), so the `invited` status — the one a speaker most needs to see — cannot reach the UI even if a component existed to render it. This is the one item on the list that genuinely needs backend work, and `PLAN-WATCH-REVIEWERS-TAB.md` §10.2 reaches the same conclusion independently.

**What would need to change:**

| File | Change |
|---|---|
| `api/app/Http/Controllers/Api/ReviewController.php` | Add `?include=pending` (or `?status=`) to `forSpeech`. Keep the default response exactly as it is — `useCommentaryTrack` consumes it for the track selector and must not start seeing `invited` rows, which is precisely the bug §4.3 of that plan speculated about. Opt-in only. |
| `api/app/Http/Resources/ReviewResource.php` | Expose `annotations_count` and `published_annotations_count` (already on the model; `web/src/features/review/types.ts:14` records that they were withheld). Needed by 7.4 as well. |
| `web/src/features/review/reviewApi.ts` | Add a `revokeAndPurgeReview` mutation. Give all four mutations `invalidatesTags` covering both `Review` and the speech. |
| `web/src/components/review/ReviewerRoster.tsx` *(new)* | Rows grouped by status — Invited / In progress / Published — each with name, `StatusBadge`, timestamp, and a destructive action. Reuse `components/ui/alert-dialog.tsx`; revoke must be confirmed and must take a reason (the endpoint already accepts `revocation_reason`). Offer **Revoke** and **Revoke and purge voice notes** as distinct choices with distinct copy — they are materially different acts. |
| `web/src/routes/SpeechWatch.tsx` | Render the roster above `InviteReviewerPanel` in the existing `reviewers` tab (`:481-487`). The tab already exists; it gains a section. |
| `web/src/components/annotation/AnnotationComposerPanel.tsx` | A coach-side **Withdraw** / **Abandon** control next to Publish, confirmed, with copy that distinguishes them ("I can't do this review" vs "I'm stopping, keep what I wrote"). |
| `web/tests/two-users.spec.ts` | Extend: invite → accept → publish → **revoke** → the reviewer's next load is a 403, and `SpeechWatch`'s existing denied branch renders. That branch is already built (`:233-271`) and currently untested from the revoke direction. |

**Risk:** medium — it's the first destructive action a non-admin can take. Mitigations: mandatory confirmation, mandatory reason, the existing audit log, and the already-built 10-second-delayed `PurgeDeletedVoiceAnnotation` dispatch pattern.

---

### 7.3 Tell the speaker their feedback arrived 🟠

> **For a ten-year-old:** Your friend finished writing notes in your diary and left it on your desk. Nobody told you. It just sits there until you happen to walk past. We should make a little bell ring when they're done.

> **The detailed version:** `ReviewService` notifies on invite (`:137`), accept (`:191`) and decline (`:216`). `publish()` at `:407` notifies nobody, and no `ReviewPublished` notification class exists. The architecture to carry it is complete — eight notification classes all using `['mail', 'database']`, a bell polling every 30s, and Horizon running the queue — so this is a new class and one `DB::afterCommit` line, following the exact pattern three times over. Two second-order problems are worth fixing in the same change. First, the bell's `describe()` switch is deliberately enumerated with no generic fallback (`NotificationBell.tsx:25-48`), so a new type without a `case` renders as a bare speech title. Second, notifications aren't links: `:91` calls `markRead` and nothing else, so even a correct notification is a dead end. The fix is to add `url` to each notification's `toDatabase()` payload and render the row as a `<Link>` — which makes all five existing types navigable too.
>
> Consider debouncing. A coach may press Publish several times as they work; `publish()` is incremental by design (it only stamps rows that are still unpublished). Notifying on `first_published_at === null` only — i.e. the first publish per review — plus a digest for subsequent ones avoids training the speaker to ignore the bell.

**What would need to change:**

| File | Change |
|---|---|
| `api/app/Notifications/ReviewPublished.php` *(new)* | Copy `ReviewAccepted.php`'s shape. `via()` → `['mail', 'database']`. Payload: `type: 'review.published'`, `actor_name`, `speech_title`, `published_count`, and a `url` deep-linking to `/speeches/{id}`. |
| `api/app/Services/ReviewService.php` | In `publish()`, inside the transaction: `DB::afterCommit(fn () => $locked->speechOwner->notify(new ReviewPublished($locked, $delta)));`. `afterCommit` is non-negotiable here — `:161` documents why. Gate on `$locked->first_published_at` having just been set, for the debounce above. |
| `api/app/Notifications/*.php` (all 8) | Add `url` to each `toDatabase()` payload. |
| `web/src/features/notification/types.ts` | Add `'review.published'` to the union and `url?: string` to the data shape. |
| `web/src/components/layout/NotificationBell.tsx` | Add the `case`. Render each row as a `<Link to={notification.data.url}>` that marks read on click. Keep the `<button>` fallback for rows without a `url`. |
| `api/tests/Feature/` | Assert the notification is sent on first publish and not re-sent on the second. |

**Risk:** low. Additive. The one thing to get right is the enumerated-switch discipline the bell's own comment asks for.

---

### 7.4 Make the speaker's speech page show, not hide, the feedback 🟠

> **For a ten-year-old:** Three friends wrote in your diary, but when you open it, it's blank — you have to tap each friend's name to find out if they wrote anything. Two of them didn't. We should put a little number next to each name so you can see at a glance who actually wrote something, and open the best one for you automatically.

> **The detailed version:** `useCommentaryTrack.ts:66` initialises `selected` to `NO_COMMENTARY`, and the chips at `TrackSelector.tsx:77-99` render only `option.label`. So the default state of the screen whose entire purpose is displaying feedback is *displaying no feedback*, and discovering which reviewer has published requires serially clicking every chip and reading the empty state. Three changes fix it, all frontend except one resource field: show a count badge per chip, default the selection to the most recently published track, and add a "new since you last looked" marker. The ordering data is already on the wire (`last_published_at`, `ReviewResource.php:33`); the counts need the one-line resource addition from 7.2. For "new", `localStorage` keyed on `(speechId, reviewId, last_published_at)` is sufficient and needs no backend at all — the same `annotationDraftStorage.ts` pattern this codebase already uses.
>
> While in here, decouple the Essay tab. Its content is driven by a selection made in a sibling tab (`SpeechWatch.tsx:431-437`), so opening Essay first yields *"Pick a reviewer to see their essay"* with no picker in sight. Either lift the chip row above the `TabsList` so it visibly governs both panels, or render a compact picker inside the Essay panel.

**What would need to change:**

| File | Change |
|---|---|
| `api/app/Http/Resources/ReviewResource.php` | Expose `published_annotations_count` (shared with 7.2 — do it once). |
| `web/src/hooks/useCommentaryTrack.ts` | Default `selected` to the review with the most recent `last_published_at`, falling back to `NO_COMMENTARY` when none has published. Keep `NO_COMMENTARY` as an explicitly selectable option — it is a real user intent ("just let me watch myself"). |
| `web/src/components/review/TrackSelector.tsx` | Chips gain a count badge and an unread dot. Extend the `aria-label` with the count — the bare visual badge is not enough, and `STEP-15` will audit this. |
| `web/src/lib/` *(new, small)* | A `lastSeenCommentary` helper over `localStorage`, mirroring `annotationDraftStorage.ts`. |
| `web/src/routes/SpeechWatch.tsx` | Lift the track chips above the `TabsList`, or add a picker to the Essay panel. |

**Risk:** low, but changing the default selection changes what `OverlayStack` renders on first paint. `web/src/components/annotation/OverlayStack.test.tsx` and `TrackSelector.test.tsx` both assert current behaviour and will need updating. Per the `e2e-aria-label-drift` lesson: grep `web/tests/` for these labels before committing, because Playwright won't fail in `vitest`.

---

### 7.5 Let a speaker edit and delete their own speech 🟠

> **For a ten-year-old:** Right now, once you put a video in, it's stuck there forever — the only way to get rid of it is to delete your whole account, like burning down the house to throw out one toy. You should be able to just throw out the toy.

> **The detailed version:** `SpeechController` has `index`, `store`, `show` and nothing else; there is no `PATCH /speeches/{speech}` and no `DELETE`. So a typo in a title is permanent, and removing one video means account erasure. For a product that stores video of the user's own face, with "nobody sees this unless you invited them" as its banner claim, this is the weakest point in the trust story and plausibly a GDPR Art. 17 problem — `MODERNIZATION_PLAN.md` §11.1 already flags that the legal groundwork is unaddressed.
>
> Most of the deletion machinery exists. `QuotaService` has a "speech was deleted: decrement by everything it held" path (`:138`), `PurgeDeletedVoiceAnnotation` establishes the delayed-purge pattern, and `MediaReconcileCommand` already reconciles orphaned objects nightly. The genuinely hard part is not plumbing but **policy**: deleting a speech destroys other people's work — a coach's eleven notes and their essay. Three defensible designs:
>
> - **(a) Soft-delete with a grace period.** Access revoked immediately, bytes purged after N days, reviewers notified. Safest, most code.
> - **(b) Hard delete, with the consequence spelled out.** Reuse `DeleteAccountDialog`'s type-the-word pattern and name exactly what dies. Simplest, and consistent with how account deletion already behaves.
> - **(c) Block deletion once any review has published.** Cheapest, but it recreates the trap in a narrower form, and the trap is the complaint.
>
> **I'd ship (b) now and (a) later.** The speaker owns the video of their own face; a reviewer's claim on their commentary about it is real but weaker. (b) is honest about the trade and reuses a dialog pattern that already exists. Reviewers' own copies are already protected: the `reviewer_annotations` export at `Account.tsx:36-41` exists precisely as this mitigation, which `STEP-11` calls out by name.

**What would need to change:**

| File | Change |
|---|---|
| `api/app/Policies/SpeechPolicy.php` | `update` and `delete` — owner-only. Add both to `$mustFallThrough` in `AppServiceProvider.php` **in the same commit**: the standing rule at `:331-337` is that an unregistered ability is an unconditional admin `true`, and these are ownership acts, not admin powers (same category as `speech.invite`). |
| `api/routes/api.php` | `PATCH /speeches/{speech}` (title, description, `delivered_on`, `change_note`) and `DELETE /speeches/{speech}`. |
| `api/app/Http/Controllers/Api/SpeechController.php` | `update` and `destroy`. |
| `api/app/Services/SpeechDeletionService.php` *(new)* | Transactional: revoke live grants, release quota via the existing `:138` path, dispatch asset purges, write `audit_log`, notify reviewers holding a grant. Model it on `AccountErasureService`, which already solves the harder version of this. |
| `api/app/Notifications/SpeechDeleted.php` *(new)* | So a coach whose work vanishes learns why, and is pointed at the `reviewer_annotations` export. |
| `web/src/routes/MySpeeches.tsx` / `SpeechWatch.tsx` | An owner-only menu: Edit details, Delete. Delete reuses `DeleteAccountDialog`'s confirm-by-typing pattern. |
| `api/app/Filament/Resources/SpeechResource.php` | Make sure the admin table distinguishes owner-deleted from admin-taken-down. They are different facts and the moderation history should not conflate them. |

**Risk:** highest on this list — it's a new destructive path over shared data. It is also the one most likely to be legally required.

---

### 7.6 Make the directory a decision surface, and allow invite-by-email 🟠

> **For a ten-year-old:** The list of helpers only tells you their name and whether they're a grown-up helper or another kid. Nothing about what they're good at. And if the person you actually want isn't in the club yet, there's no way to ask them to join — you just can't pick them. We should show more about each helper, and let you email someone who isn't here yet.

> **The detailed version:** Two separate problems that compound.
>
> *The directory isn't a decision surface.* Rows carry name, `@username` and a `member`/`coach` badge, as inert `<li>`/`<span>` (`ReviewerDirectory.tsx:120-133`). No avatar, no bio, no link to the profile — even though `profiles.bio` is 1,000 characters, `avatar_path` exists, and `/u/{username}` is a fully built public profile with a timeline and a connections rail. `PLAN-POST-ONBOARDING-UX.md` F2 found the matching problem from the other end: `Onboarding.tsx:292` was, before that plan shipped, the *only* in-app navigation to a profile anywhere in the app (that line no longer exists; the sidebar now carries a `Your profile` item). There is also no specialty, expertise or availability concept at all — `scopeReviewerCandidates` filters on role and a `LIKE` over name/username, nothing more. So "find someone good at wedding speeches" is not expressible.
>
> *Invite-by-email doesn't exist.* `InviteReviewerRequest` requires `reviewer_id` with `exists:users,id`. So a speaker can only invite people **already registered**. Combined with the no-open-pool rule, a brand-new user whose actual coach isn't on the platform has no path at all. For a product whose natural first invitation is "my existing speech coach" or "my friend who's good at this", that's the cold-start problem at its sharpest.

**What would need to change:**

*Part A — the directory (frontend-only, do first):*

| File | Change |
|---|---|
| `api/app/Http/Controllers/Api/ReviewerDirectoryController.php` | Include `bio` (truncated) and a reviews-completed count. **Avatar needs no backend work** — `ReviewerDirectoryResource` already emits `avatar_url` via `MediaUrlSigner`, and `ReviewerDirectoryEntry` already types it; both directory UIs simply never render it. Rendering it is a frontend-only change. Keep it one query — the `connections` rail's single-aggregate approach (R19) is the precedent. |
| `web/src/routes/ReviewerDirectory.tsx` | Rows become `<Link to={'/u/' + username}>` cards with avatar and bio excerpt, plus a direct **Invite to a speech** action (a speech picker, since the directory isn't speech-scoped). |
| `web/src/components/review/InviteReviewerPanel.tsx` | Same row treatment. The profile link must open in a new tab or preserve the half-written invitation — `keepMounted` protects against a tab switch (`SpeechWatch.tsx:476`) but not against navigation. |

*Part B — specialties (needs schema):*

| File | Change |
|---|---|
| `api/database/migrations/` | `speech_topics` + `profile_topics`, or a simpler `profiles.specialties` text array. Plus `profiles.accepting_reviews` boolean — a coach's single most useful signal, and the cheapest. |
| `api/app/Models/User.php` | Extend `scopeReviewerCandidates` with a topic filter. Keep the `->role([...])` guard first and untouched; §7.1's "an Admin must NEVER appear here, regardless of any other filter" is load-bearing. |
| `web/src/routes/Onboarding.tsx` / `ProfileEdit.tsx` | Let a coach declare specialties and availability. |

*Part C — invite-by-email (biggest, most valuable):*

| File | Change |
|---|---|
| `api/database/migrations/` | Make `reviews.reviewer_id` nullable with an `invited_email` + signed-token pair, **or** add a `pending_invitations` table that converts to a `review` on signup. Prefer the second: `reviews` is the access grant, and `MODERNIZATION_PLAN`'s central insight is that grant and annotation set are one row. A grant to a user who doesn't exist yet weakens exactly that invariant. |
| `api/app/Http/Requests/InviteReviewerRequest.php` | Accept `reviewer_id` **or** `email`, exactly one. |
| `api/app/Notifications/ReviewInvitedByEmail.php` *(new)* | An off-platform invitation with a signed accept link. Rate-limit hard — this is an outbound-email surface a spammer would love. The `connection-request` limiter (`AppServiceProvider.php:391-395`) is the pattern. |
| `api/app/Actions/Fortify/CreateNewUser.php` | On registration, convert any pending invitations for that email. Pairs naturally with 7.1, which already touches this file. |

**Risk:** Part A low; Part B low; **Part C is a schema change with an abuse surface** and deserves its own plan document in this repo's style.

---

### 7.7 A keyboard map for the player and the composer 🟡

> **For a ten-year-old:** Right now you have to pick up the mouse and click for every single note. If you're writing thirty notes about one video, that's thirty trips. Letting you press a key instead — one for "jump back five seconds", one for "mark this moment" — is like having the remote control in your hand instead of walking to the TV.

> **The detailed version:** `grep -rn "onKeyDown\|addEventListener('keydown')"` over `web/src` finds one handler, in `useVoiceInterjections.ts:252`. `STEP-15-accessibility.md` specifies the full map — `Space` play, `J`/`L` ±5s, `,`/`.` frame-step, `[`/`]` between annotations, `C` to stamp a timestamp **from inside the textarea** ("it is the core action, so it lives where your hands are"). STEP-15 is not built. This is simultaneously the coach's biggest efficiency win and a WCAG 2.2 AA requirement, so it should be done once, as one piece of work, rather than half now as a convenience feature and half later as a compliance fix.
>
> STEP-15 also names the load-bearing accessibility decision, and it is worth restating because it is easy to get backwards: **the transcript list, not the overlay, is the authoritative accessible surface.** The overlay is `aria-hidden` on purpose — a live region firing every few seconds over playing speech audio is a denial of service, not an accessibility feature. `Transcript.tsx` already exists; STEP-15's instruction is "if you have time for one thing here, make that list excellent."

**What would need to change:**

| File | Change |
|---|---|
| `web/src/hooks/useMediaKeyboard.ts` *(new)* | The §8.6 map. Must no-op when focus is in a text input — except `C`, which is specified to work *inside* the textarea. |
| `web/src/components/annotation/TimelineStrip.tsx` | Roving `tabindex` across markers. Each announces *"Annotation at 1 minute 23 seconds"* — **never** bare `1:23`, which screen readers pronounce as a ratio. |
| `web/src/components/annotation/Transcript.tsx` | `aria-current` on the playing row, and — per STEP-15 step 8 — focus must **not** follow it, or a keyboard user is trapped on a moving target. |
| `web/src/components/annotation/Composer.tsx` | `C` stamps the current timestamp at the caret. Note `useAnnotationEditor.ts:523` already documents using `onBeforeInput` rather than `onKeyDown` for text — respect that boundary. |
| A help affordance | `?` opens a shortcut sheet. Undiscoverable shortcuts help nobody. |
| `web/tests/` | A keyboard-only Playwright pass. STEP-15 notes every hook it needs already exists — `data-visible`, the `data-testid` module, `E2ESeeder`, the `login-as` route, `FakeTranscoder` — so "adding it later is not a refactor." |

**Risk:** low, and it unblocks a step that's already scheduled.

---

### 7.8 Surface storage and upload limits before they're hit 🟡

> **For a ten-year-old:** Your toy box has a size limit, but nothing shows you how full it is. You only find out it's full when the lid won't close. A line showing "you've used 3 of 5 boxes" means you're never surprised.

> **The detailed version:** `QuotaService` enforces 5 GiB and a hard cap of 2 concurrent uploads atomically, in a single `UPDATE … WHERE storage_bytes_used + ? <= quota_bytes AND uploads_in_flight < 2` (`:77-78`) — never check-then-act, which is exactly right. But `grep -rn "quota\|storage" web/src --include="*.tsx"` finds nothing: the limits are invisible until they fire as *"This upload would exceed your storage quota, or you already have 2 uploads in progress."* That string also conflates two different problems with two different remedies — one means "delete something", the other means "wait five minutes". Both numbers are already on `users`, and `UserResource::formatBytes` already exists in the Filament resource (`:155`) and can be lifted.

**What would need to change:**

| File | Change |
|---|---|
| `api/app/Http/Resources/UserResource.php` | Add `storage_bytes_used`, `quota_bytes`, `uploads_in_flight`. `/api/me` is already fetched on every authenticated route, so this costs no request. |
| `web/src/features/auth/types.ts` | Extend `CurrentUser`. |
| `web/src/components/speech/UploadDashboard.tsx` | A quota meter above the picker, and a pre-flight client-side check against the selected file's size — a clear "this file is 1.2 GB and you have 400 MB left" beats a 422 after an upload starts. |
| `api/app/Services/QuotaService.php` | Split the message into two distinct ones. Different cause, different fix, different copy. |
| `web/src/routes/Account.tsx` | Show the quota alongside the export/delete sections, where a user who needs to free space is already standing. |

**Risk:** very low. Don't move the enforcement — the atomic `UPDATE` is correct and the client check is advisory only.

---

### 7.9 A real landing page 🟡

> **For a ten-year-old:** The front door of the shop has a sign saying "the builders finished the walls." It doesn't say what the shop sells or how to come in.

> **The detailed version:** `web/src/routes/Home.tsx` renders a heading and *"Frontend foundation is up."* `/` carries no guard, so it is what every logged-out visitor sees. Nothing inside the app ever links there — a grep for navigation to `/` returns zero hits, and logout goes to `/login` (`LogoutButton.tsx:55`) — so it is reached only from outside: the bare domain typed or bookmarked, a shared root link, or any external referral. That is precisely the first-impression traffic. There's no explanation, no link to register, no statement of the privacy model. That last one matters: *"nobody sees your speech unless you personally invited them"* is this product's actual differentiator against uploading to YouTube and sharing a link, and it is currently stated nowhere a prospective user will read it.

**What would need to change:** `web/src/routes/Home.tsx` only — a value proposition, the privacy rule stated plainly, how the loop works (upload → invite → watch feedback appear at the exact moment), and Register / Log in. Reuse `PageShell` and the existing `ui/` primitives; this needs no new components and no designer-led pass (which `STEP-15` excludes anyway). Redirect an authenticated visitor to `/dashboard`, consistent with `getPostLoginDestination`'s rules in `web/src/lib/roles.ts`.

**Risk:** none. One file, no logic.

---

### 7.10 An audit log browser, and a super-admin oversight view 🟡

> **For a ten-year-old:** The club keeps a notebook of everything the grown-ups do. But you can only read one page at a time, and only by looking up one person first. Nobody can just read the notebook.

> **The detailed version:** `audit_log` is append-only by design and is written by every destructive admin action with a mandatory reason. It is readable in exactly one place: the last 50 rows for a single user, on `ViewUser` (`:365`, `limit(50)` with no pagination — deliberately a summary). There is no `AuditLogResource` in `api/app/Filament/Resources/`. So *"what happened this week?"*, *"what has admin X been doing?"* and *"when was this user's speech taken down, and by whom?"* all require database access. For the one table whose whole purpose is accountability, that's an odd stopping point — and it is the gap that makes the super-admin role feel invisible, since overseeing other admins is precisely what distinguishes it.
>
> Two design notes. The resource must be **read-only** — no create, no edit, no delete actions — or it stops being an audit log. And `canView()` should gate it to `Role::ADMIN_TIER`, following `ModerationQueuesWidget.php:118-123`'s reasoning: a policy-based gate here would silently allow *everyone*, because no `viewAny` method exists in `api/app/Policies/` and Laravel's missing-method fallback is `Response::allow()`. That trap is documented; don't walk into it.

**What would need to change:**

| File | Change |
|---|---|
| `api/app/Filament/Resources/AuditLogResource.php` *(new)* | Read-only table: timestamp, actor, action, target, reason. Filters on actor, action, date range. No `recordActions`, no `toolbarActions`. |
| `api/database/migrations/` | An index on `audit_log (created_at DESC)` and `(actor_id, created_at)`. `PLAN-ADMIN-DASHBOARD.md` §10 cut indexes because `audit_log` had 0 rows — correct then. A browsable log changes that calculus, and these two are the only ones it needs. |
| `api/app/Filament/Widgets/` | Optionally a "recent admin activity" tile on the dashboard. The `canView()` + `ADMIN_TIER` pattern is established. |
| `api/app/Filament/Resources/UserResource.php` | A "holds elevated access" filter, so a super-admin can see the admin roster in one view. |

**Risk:** low, provided it stays read-only.

---

## 8. What I would not change

Worth stating explicitly, because several of these look like candidates for "cleanup" and are load-bearing:

1. **The scoped `Gate::before` and its `$mustFallThrough` list** (`AppServiceProvider.php:300-381`). A blanket admin bypass would silently grant admins essay-write, caption-write, and reviewing. The comment at `:348-352` already warns this is the easiest block in the file to delete by mistake. Every new ability must be added to it in the same commit.
2. **No open pool.** `ReviewerDirectory.tsx:66`'s copy is the right product decision, not a limitation. Fix discovery *within* consent (7.6), never by relaxing it.
3. **`roles: []` treated as the normal case** in `web/src/lib/roles.ts`. Still correct after 7.1 — defence in depth.
4. **The transcript list, not the overlay, as the accessible surface.** Explained in 7.7. Easy to get exactly backwards.
5. **"Pause on first keystroke."** The best UX decision in the product. Keep it a persisted preference, not a global default.
6. **The voice-note volume warning** at >6 notes. Design empathy for the person receiving the feedback; almost nothing does this.
7. **`data-visible` as a test contract.** `STEP-15` says it outright: it exists so cue timing can be asserted without touching opacity or pixels, and someone will refactor it away if the reason isn't written down. It is written down. Leave it.
8. **The honest error-state branching** in `SpeechWatch.tsx:233-271`. 403 vs 404 vs network, each with its own copy, and a catch-all specifically so the infinite-spinner bug can't return. This is better than most production apps and should be the template for every new screen.

---

## 9. Suggested sequencing

| Phase | Items | Why this order |
|---|---|---|
| **1 — unblock the loop** | 7.1 | Nothing else matters while the directory is empty. Three lines plus a backfill. |
| **2 — close the promise** | 7.2, 7.3 | Revoke makes the headline guarantee real; the publish notification makes the payoff visible. Together they complete the invite→feedback→control loop end to end. |
| **3 — make the payoff legible** | 7.4, 7.9 | Feedback visible by default; a front door that explains the product. Both nearly pure frontend. |
| **4 — trust and legal** | 7.5 | Speech delete. Highest-risk item here, likely legally required, and §11.1 is still open. Deserves its own plan document first. |
| **5 — growth** | 7.6 (A, then B, then C) | A is frontend-only and immediate. C is a schema change with an abuse surface and needs its own plan. |
| **6 — the scheduled step** | 7.7, 7.8, 7.10 | 7.7 *is* STEP-15, which is next anyway. 7.8 and 7.10 are small and fit alongside it. |

A reasonable single-sitting slice is **7.1 + 7.3 + 7.9**: one backend action, one notification class, one placeholder page — and it converts the product from "cannot be used" to "can be used end to end."

---

## 10. Verification notes

Everything in §§1–6 was read from the working tree at `8b142c4`. Specifically:

- `roles: []` on registration confirmed by reading `CreateNewUser.php` in full and by `grep -rn "assignRole\|syncRoles" api/app api/database`, which finds exactly three assignment sites, none in the registration path.
- Callerless mutations confirmed two ways: `grep -rln` per hook name across `web/src`, and a text search for the words *Revoke*, *Withdraw* and *Abandon* in all non-test `.tsx` files.
- The absent publish notification confirmed by reading `ReviewService::publish()` in full and by listing `api/app/Notifications/`.
- The absent speech `PATCH`/`DELETE` confirmed by `grep -n "public function" api/app/Http/Controllers/Api/SpeechController.php` (three methods) and by reading the speech route block in `api/routes/api.php`.

**Not verified:** I did not run the stack, the Pest suite, or Playwright for this review. Three consequences worth flagging:

- Scores in §6 are judgements about the shipped surface, not measurements.
- §7.1's claim that the directory is empty in production is a code-level deduction. It would take about two minutes to confirm against the running app: register a fresh account, open `/reviewers`, and check whether any non-coach appears.
- If any test currently asserts `roles: []` for a new user, 7.1 will break it. Grep before committing.
