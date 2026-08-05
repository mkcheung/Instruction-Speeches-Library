# Step 06 — Watch the commentary

**Duration:** 2–2.5 weeks · **Depends on:** [03](STEP-03-upload-and-watch.md), [05](STEP-05-invitation-loop.md) · **Unblocks:** [07](STEP-07-write-commentary.md)
**Plan:** [§12 S6](MODERNIZATION_PLAN.md) · [§8.2 the engine](MODERNIZATION_PLAN.md) · [§8.5 playback](MODERNIZATION_PLAN.md) · [§7.3 access](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished — **this is the flagship**

> Pick a reviewer's track and watch each note **fade in at its timestamp and fade out after its duration**, with two overlapping notes stacked.

This is the feature the 2013 project was reaching for and never finished. It works here.

### Demo script

1. `php artisan annotations:seed {review}` — fixtures at three timestamps, **two deliberately overlapping**.
2. Open your speech. Pick that reviewer from the radiogroup.
3. Play. At 0:14 a note **fades in**. Six seconds later it **fades out**.
4. At 1:02 two notes overlap. They **stack**, ordered by start time — they do not clobber each other, which is the bug the legacy code had.
5. **Drag the scrubber backwards to 0:10.** Play forward. The note at 0:14 **fires again**.
6. **Drag forward past 1:02 and back.** The right cues re-activate. No ghosts, no stuck overlays.
7. Switch to another reviewer mid-playback. The first set **cross-fades out**, the second in.
8. Pick "No commentary". Clean video.
9. Below the player, the **linear transcript list** — same data, readable without watching. Click a row to seek.
10. Open it on an iPhone and go **native fullscreen**. The overlay is gone (iOS renders no HTML there) but the text arrives as **subtitles**.

## Backend

- `annotations` with `review_id NOT NULL`, the soft-delete live-row scoping, both indexes leading with `review_id`, and the CHECK on start and duration.
- **Read endpoints only.**
- ⚠️ **`Annotation::visibleTo($user)` as a query scope bound to the viewer's relationship to the review, applied at the repository layer** — §8.5 is emphatic this cannot be a controller's responsibility. One forgotten `where` leaks a reviewer's in-progress thinking to the person being assessed.
- `readAnnotations` in full.
- Track-selection validation: the endpoint takes a single `review` id, confirms it belongs to this speech and passes `readAnnotations`, and **rejects rather than silently falling back to "no commentary"** — which would look like a reviewer having written nothing.
- `php artisan annotations:seed {review}` writing fixtures at literal timestamps.

## Frontend

**The engine:**
- `useTimedAnnotations` with the **always-on 250 ms reconciler** and all three drivers.
- Cues built through **the same `normalize()` the reconciler uses** — one normalization function, or the preview and production disagree.
- Rebuilds keyed on the **timing signature**, incremental cue diffing, the `WeakMap` track cache, `try/catch` around every `new VTTCue`, string ids, the set-equality bail.

**The playback surface:**
- `OverlayStack` with **every node mounted and `data-visible` toggled** (§5.4).
- The three-simultaneous cap applied **in the consuming component**.
- The `[t−12s, t+12s] ∪ active ∪ ghosts` render window — sixty annotations with `will-change` is sixty compositor layers.
- Cross-fade on track switch, with prefetch on hover.
- The **linear transcript list** — `<ol>`, timecoded, `aria-current`, click-to-seek, auto-scroll suppressed on focus-within and for 4s after a manual scroll.
- The iOS `webkitbeginfullscreen` subtitle-track fallback.
- The prior attempt's `change_note` beside the player when a speech supersedes another, and the anonymized prior commentary when the speaker opted in (§6.11).

## Deliberately stubbed

**Annotations are created by an artisan command, not by a human** — authoring is [step 07](STEP-07-write-commentary.md). The draft/published distinction is **fully enforced on read** against seeded rows of both kinds.

The "anchor the overlay to the top when captions are showing" rule is **coded but untriggered** until step 09 — leave a comment saying so, or it gets deleted as dead code.

## Containers introduced

None.

## Acceptance

- [ ] Seeded annotations at three timestamps, **two overlapping**; each fades in on time and out after its duration, the pair **stacked**
- [ ] ⚠️ **Scrubbing backwards and forwards re-activates the correct cues**
- [ ] A seeded draft written after publication is **not visible to the speaker** — asserted at the endpoint against a review holding both published and draft rows
- [ ] Verified in Chrome **and Safari**, and on iOS **including native fullscreen**
- [ ] `computeActive` has **exhaustive unit coverage** — boundaries, overlaps, zero durations, `NaN`, negative starts — in microseconds with no browser

## Watch for

The cue-latency table you committed in [step 00](STEP-00-foundation.md) decides the **default driver** here. That is what it was for.

⚠️ The reconciler is what makes WebKit's `cuechange` behaviour a **precision regression rather than a break** (R1). Do not "optimize" it away because the TextTrack path seems to work — it is the fallback that makes the whole engine safe.

---

## 🎓 Optional next: [CP-06](CP-06-testing-time-based-ui.md)

| | |
|---|---|
| **Learn** | Testing time-based UI |
| **Track** | Playwright |
| **Time** | ~4h |

**This is optional.** [Step 07](STEP-07-write-commentary.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
