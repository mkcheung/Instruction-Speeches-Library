# Step 13 — The social layer

**Duration:** 2.5–3 weeks · **Depends on:** [04](STEP-04-every-video-plays.md), [05](STEP-05-invitation-loop.md) · **Unblocks:** [15](STEP-15-accessibility.md)
**Plan:** [§12 S13](MODERNIZATION_PLAN.md) · [§6.7 connections and the social surface](MODERNIZATION_PLAN.md) · [§6.11 speech versioning](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished

> Connect with someone, open their profile, and see **exactly the speeches of theirs you reviewed, with exactly your own commentary on them.**

### Demo script

1. Send someone a connection request. They accept.
2. Open their profile. Two columns: a **connections rail** on the left, a **timeline feed** on the right — the Facebook layout from your reference screenshot.
3. Each connection tile shows a face, a name, and a metric line: **"6 reviews together"** / **"You reviewed 4"** / **"Reviewed 2 of yours"**.
4. The timeline shows their speeches **you personally reviewed** — 16:9 thumbnail, title, date, and a block reading **"Your commentary — 12 notes · essay"**.
5. Click **"Watch with your commentary →"**. Straight into the player with your track selected.
6. ⚠️ **Nowhere on this page can you see anyone else's commentary.** There is no "view more comments", and nothing hints that other reviewers exist.
7. Open the profile of someone you've connected with but **never reviewed for.** The timeline is **empty** — by design. The page is titled *"Your history with Jordan"*, so it reads as accurate rather than broken.
8. If a speech supersedes an earlier one, an **arc strip** shows the version history.
9. Block someone. They vanish from your rail. **Their existing review of your speech still exists** — blocking is not revoking.

## Backend

- `connections` with **mirrored writes through `ConnectionService`**, ⚠️ **always lower-user-id-first** to avoid the AB-BA deadlock, the state machine, blocking, the four CHECK constraints, and **the nightly asymmetry reconciler**.
- `reviews.speech_owner_id` and the two composite **partial** timeline indexes — ⚠️ **added here, with the `EXPLAIN` test that justifies them** (§12.1: denormalizations ship with the query that needs them).
- The single `GROUP BY` for the whole connections rail.
- Per-pair invite rate limiting and the `blocked` check **in the request-creation path**, not the read path (R17).
- The recursive-CTE arc chain (§6.11), bounded at depth 10.

## Frontend

- **The profile page:** cover, identity block, routed section nav (⚠️ **`<nav>` + links, not a `role="tablist"` widget** — these are URLs people share and go back to), the connections rail with its metric line, the timeline feed with **cursor pagination**, the two tabs *Reviews you left* / *Reviews they left you*, and the privacy indicator in the slot Facebook uses for the audience icon: `🔒 Private · visible to you because you reviewed it`.
- **Empty states, which matter more here than anywhere else in the product**, because a connection with no shared review renders an empty timeline **by design**.
- The **arc strip** — version history on the timeline, which is the page where a working history is already the subject.
- The Filament connections view (tables and aggregates).

## Deliberately stubbed

**No reactions, no likes, no comment threads, no composer pill** — §6.7.4 gives a different reason for each, and building the composer's input box is how a cut feature comes back.

Posters already exist from [step 04](STEP-04-every-video-plays.md), so this step inherits them.

## Containers introduced

None.

## Acceptance

- [ ] ⚠️ **The `Speech::scopeVisibleTo` snapshot test passes unchanged after the connections migration** — the invariant that **a connection grants nothing**
- [ ] ⚠️ **The same test passes for the arc chain** — being shown that v2 exists never makes v2 playable
- [ ] A viewer sees only speeches they personally reviewed, **with only their own commentary**
- [ ] Crossed connection requests resolve to `accepted` under a **concurrency test**
- [ ] ⚠️ **`EXPLAIN` on the timeline query shows no `Using filesort` and no `Using temporary`**
- [ ] The rail's metric line is **one query for the whole rail** — asserted by **query count**, not by reading the code (R19)
- [ ] **Unblocking lands on `declined`, never `accepted`** — silently restoring a severed relationship is a support ticket

## Watch for

⚠️ **This is the step where the security model is most likely to be quietly widened**, and the pressure will come from a *sympathetic* direction: *"we're connected, why can't I see their speeches?"*

The snapshot test on `scopeVisibleTo` looks like overkill until you remember §6.3 killed a `visibility` column for exactly this hole. **`connections` is a routing table, not an ACL** — it decides whose profile is reachable and who may be invited, and it never appears in a `WHERE` clause returning speech or annotation content.

**On copying Facebook:** take the visual system wholesale — canvas colour, card treatment, two-column proportions, the rail's rhythm, the 15px/13px type pairing. **Do not take the comment thread**: Facebook comments are public to every viewer of a post; ours are private and per-viewer filtered.

Worth noting the convergence: **dropping the engagement row and comment thread for privacy reasons is also exactly what makes a 16:9 video card fit.** A naive copy gives a 739px card — one per viewport. Ours is ~447px.

**This is the largest removable block** if the timeline needs cutting. The core coaching product works without it.

---

## 🎓 Optional next: [CP-13](CP-13-visual-regression.md)

| | |
|---|---|
| **Learn** | Visual regression |
| **Track** | Playwright |
| **Time** | ~3h |

**This is optional.** [Step 14](STEP-14-deploy-hardening.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
