# Step 05 — The invitation loop

**Duration:** 2–2.5 weeks · **Depends on:** [01](STEP-01-identity.md), [03](STEP-03-upload-and-watch.md) · **Unblocks:** [06](STEP-06-watch-commentary.md), [08](STEP-08-essay.md), [12](STEP-12-admin-portal.md), [13](STEP-13-social-layer.md)
**Plan:** [§12 S5](MODERNIZATION_PLAN.md) · [§6.3 reviews](MODERNIZATION_PLAN.md) · [§7.3 access](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished

> Invite a named person to review your speech; they see it in their dashboard, accept, and can watch your video — **and nobody else can.**

### Demo script

1. Open one of your speeches. Click **Invite a reviewer**.
2. Search the **reviewer directory** — browsable, filterable, searchable. Pick someone.
3. Write them a message. Send.
4. Log in as that person. **The invitation is in their dashboard**, oldest-first.
5. Accept it. **Now they can play the video.** Before accepting, they could see only the title, duration and your name.
6. Repeat with two more people — one Coach, one ordinary Member.
7. Back as the speaker: the track selector offers **all three names**, plus "No commentary".
8. Log in as reviewer A. **Try to reach reviewer B's work by URL.** 403 — and nothing anywhere tells A that B exists.

## Backend

- `reviews` with the §6.3 state machine and **every invariant that *is* the table**: `UNIQUE(speech_id, reviewer_id)`, `reviewer_id` nullable SET NULL, `speech_id` cascade, **no `deleted_at`**, the counter-cache CHECK, and `ReviewService::assertNotSelfReview`.
- **`invitation_message`, `allow_preview`, `prior_commentary_shared`** (§6.11) on the review.
- Accept as an **idempotent upsert**. Decline, withdraw, revoke, revoke-and-purge, abandon.
- `Speech::scopeVisibleTo` and the **two access tiers** — request metadata to an invitee, the signed playback URL only on a granting status.
- `last_transition_at` (§7.5) — one sort key for every dashboard section.
- The reviewer directory query.
- Laravel's `notifications` migration with queued invite / accept / decline mail.
- `SpeechPolicy` and `ReviewPolicy` including `accept`'s **categorical admin denial**, and the `Gate::before` fall-through list.

## Frontend

- The invite composer — search by name or username, a per-invitation message, the `allow_preview` toggle, and — when the speech supersedes an earlier one — the **"share the previous version's feedback (anonymized)"** opt-in.
- **The reviewer directory as a real feature**: browsable, filterable by credential, searchable, good enough to pick a stranger from. §6.3 is explicit that with no open pool, **this is the only discovery mechanism** and must be budgeted as a feature rather than a list.
- The reviewer dashboard, four sections, invitations oldest-first.
- Accept / decline.
- The speaker's track-selector **radiogroup** with **"No commentary" as a real option**.
- The in-app notification bell.

## Deliberately stubbed

Selecting a reviewer's track shows *"Jordan hasn't left commentary yet"* — an honest empty state that survives into step 06 unchanged. The essay tab exists in the tab strip and is **disabled**. **Coaches are still made by `php artisan user:grant-role`** — the real path to the badge is step 12.

## Containers introduced

None.

## Acceptance

- [ ] A Member invites **two Coaches and one other Member by name**; all three accept and the track selector offers all three
- [ ] A concurrency test fires the **same** reviewer's accept twice and asserts **one row**
- [ ] Re-inviting someone who declined **reuses the existing row** rather than throwing a duplicate key
- [ ] **Reviewer A cannot read Reviewer B's review, and cannot see that B exists** — verified by direct API call
- [ ] Self-invitation is refused by the exception **thrown from the service, not the controller** — asserted by calling the service directly, because §7.4 says policies are advisory

### Two negative assertions carry the access rule — neither is optional

- [ ] ⚠️ **No endpoint exists that lists reviewable speeches.** Assert the **absence** by walking `Route::getRoutes()`, not a 403 — §7.1 records this as `—`, not `❌`
- [ ] ⚠️ **An Admin cannot accept an invitation**, by direct API call against a seeded admin

## Watch for

**The Member-reviewer case is not optional in the acceptance run.** Without it the peer path ships untested, and it is the one path where a `hasRole('coach')` check left in by habit **fails silently rather than erroring**.

---

## 🎓 Optional next: [CP-05](CP-05-two-users-one-test.md)

| | |
|---|---|
| **Learn** | Two users in one test |
| **Track** | Playwright |
| **Time** | ~4h |

**This is optional.** [Step 06](STEP-06-watch-commentary.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
