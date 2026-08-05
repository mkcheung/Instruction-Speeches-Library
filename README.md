# Speech Coaching Platform — audit and rebuild plan

In 2013 I started a PHP application for annotating videos of speeches. I abandoned it in October 2014, mid-refactor. **It has sat untouched for eleven years.**

This repository is what happened when I came back to it: a full audit of the dead codebase, and a plan to rebuild it properly — worked out with Claude, verified against primary sources, and documented including the parts that turned out to be wrong.

**There is no application code here yet.** The deliverable is the plan and the evidence behind it.

---

## What's here

| | Lines | What it is |
|---|---|---|
| **[MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md)** | 2,939 | The full specification — architecture, schema, security model, risk register, and **74 citations into the legacy code by file and line** |
| **[ARCHITECTURE-EXPLAINED.md](ARCHITECTURE-EXPLAINED.md)** | 904 | The same thing in plain language, for explaining rather than building |
| **[STEPS.md](STEPS.md)** + 16 files | 1,353 | Sixteen vertical slices. **Fifteen end with something you can open in a browser.** Each carries a demo script — the literal click-path to prove it works |
| **[LEARNING-TRACK.md](LEARNING-TRACK.md)** + 16 files | 2,903 | A parallel CI/CD and Playwright curriculum, one checkpoint between each build step |
| **[legacy/](legacy/)** | 6,800 | The original 2013–2014 code. Kept deliberately — see [why](legacy/README.md) |

---

## What the product does

A speaker uploads a video of themselves giving a speech and **invites specific people to review it**. Reviewers leave notes anchored to exact moments. On replay, those notes fade in at their timestamps and fade out after their duration. Coaches can leave **spoken** notes: the video pauses, you hear them, and it resumes.

One rule shapes the whole design:

> **Nobody sees your speech unless you personally invited them.** No public list, no way to volunteer.

---

## Why the original failed — and why that's the interesting part

Not "it was old." Two structural problems, both found by reading the code:

**The `notes` table has no author column.** Timestamped commentary existed; attribution never did. Four of the stated requirements depended on knowing who wrote a note. **The project was not unfinished — it was unfinishable**, and had been since the schema was written.

**There was no ownership check anywhere.** Any logged-in user could enumerate `viewTopicVideo.php?topId=1,2,3…` and watch every private speech.

The rebuild's central design decision answers the first directly: the access grant and the annotation set are **one row**, so an unattributed annotation is *structurally impossible* rather than merely forbidden. That principle — **make wrong states unrepresentable, don't police them** — recurs throughout the plan.

---

## How this was built

This is a portfolio piece about *process* as much as product.

**Parallel research agents.** Each revision dispatched multiple Claude subagents against separate questions — auth, media, schema, social graph, containerization — then reconciled their findings. Where they disagreed with me, I recorded which won and why.

**`validate → review → improve → validate`.** Five revisions. Each one re-examined the last rather than only adding to it.

**Claims were checked, not asserted.** A MySQL uniqueness assumption was tested empirically in a Docker container. Dependencies were checked for liveness — which found **Popcorn.js archived since 2018**, **MinIO archived in 2026**, **Redis relicensed in 2024**, and five dead audio libraries.

### The corrections are the evidence

Anyone can generate a plan. What's harder to fake is a plan that documents its own mistakes:

- **A misread HTML spec.** Revision 2's annotation engine was built on a wrong reading of `activeCues` and the show-poster flag. Caught, and the engine rewritten.
- **A design that silently broke the flagship feature.** Revision 2's coaching model permitted only one coach per speech, destroying the track selector — the exact feature whose absence made the original unfinishable.
- **An inverted browser fact.** The plan taught that Chromium in CI lacks H.264. Verification found that reversed in Playwright 1.57 — and that the problem had **relocated to arm64**, where it now fires on my own laptop. Better lesson, opposite fact.
- **Stale tooling with a deadline.** Every `actions/*` major version was out of date, and Node 20 leaves GitHub runners in September 2026 — breaking `upload-artifact@v4`, which Playwright's own documentation still recommends.

### And the failures

**Five of eight research agents were killed by platform session limits.** [§4 of the plan](MODERNIZATION_PLAN.md) carries a provenance table naming **exactly which sections are verified and which are not** — because a document that hides that is less trustworthy, not more.

Two sections are marked ⚠️ **unverified** and say so at the point of use.

---

## Decisions worth defending

Each of these is argued in full in the plan; here's the one-line version.

| Decision | Because |
|---|---|
| **Session auth, not JWT** | Everything sensitive here is *revocation*. A suspended user keeps a valid token for its whole TTL — **25 minutes of continued access to video of someone's face, versus under 10** |
| **PostgreSQL, not MySQL** | Partial indexes removed a generated-column workaround used four times — including the one identified as the riskiest DDL in the plan |
| **Videos never in the database** | The product is scrubbing through video. That needs byte-range seeking, which a filesystem does natively and a database cannot do at all |
| **No public request pool** | Removed at the point where "anyone can review" would have let a stranger self-grant access to a video of your face. Not blocked — **unrepresentable** |
| **Admins moderate, never author** | Removing the capability deleted a loophole: *"add one throwaway annotation and now you're an admin viewing, not a peer peeking"* |
| **Voice notes interrupt, not overlay** | Overlay hit two unfixable blockers — cross-origin Web Audio silence, and `volume` being a no-op on iOS. Interrupting costs 2 weeks instead of 4.5 **and is the better product** |

---

## Honest status

- **No application code.** This is a plan, not a codebase.
- **34–41 weeks** estimated to production-ready for one developer. The first browser-viewable increment lands in **week 3**.
- **Two sections unverified**, marked as such.
- **Four decisions still open**, listed in §20 with the consequences of each choice.

The legacy tree contains no credentials — checked before publishing.

---

*Built with [Claude Code](https://claude.com/claude-code). The commit history shows 2013–2014, an eleven-year gap, and then this.*
