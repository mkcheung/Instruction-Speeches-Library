# Step 07 — Write the commentary

**Duration:** 2–2.5 weeks · **Depends on:** [06](STEP-06-watch-commentary.md) · **Unblocks:** [10](STEP-10-voice-annotation.md), [11](STEP-11-privacy-erasure.md)
**Plan:** [§12 S7](MODERNIZATION_PLAN.md) · [§8.4 authoring](MODERNIZATION_PLAN.md) · [§10.2 optimistic locking](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished — **the core loop is complete here**

> Watch a speech, type at a timestamp, nudge it half a second, publish the set, and the speaker sees **exactly what you published and none of your drafts.**

At the end of this step the product does the thing it exists to do: upload → invite → accept → annotate → play back with fades.

### Demo script

1. As an invited reviewer, open the speech. Play it.
2. **Start typing.** The timestamp stamps itself on your first keystroke — no button.
3. Nudge it with `⟨ ⟩`. Set how long it should stay on screen.
4. Watch the **live preview** — the same overlay the speaker will see, with a dashed border marking it provisional.
5. Add two more. The **timeline strip** below the scrubber shows coverage and gaps.
6. Delete one. A **6-second Undo toast** appears. Press it. It comes back.
7. **Open the same speech in a second tab and edit the same note.** The clean tab silently adopts; the dirty one shows an inline banner — and **your text is never discarded.**
8. Press **Publish**. It shows a count.
9. Log in as the speaker. Play. **You see exactly the three published notes.** Write a fourth as the reviewer without publishing — the speaker still sees three.

## Backend

- Annotation CRUD with `client_uuid` idempotency (unique **scoped to live rows** — a partial index, §5.8a).
- `lock_version` optimistic locking returning **409 with the current record in the body** and a `conflictSource` field.
- Publish and publish-additions, scoped to the caller's own review.
- Counter caches maintained **in the same transaction as every write**; `last_transition_at` on every status transition; `accepted → in_progress` on the first annotation.
- `clearAnnotations` and `abandon` routed through `ReviewService` with a `deleting` model event — ⚠️ **Eloquent's `SoftDeletes` never fires a database `ON DELETE CASCADE`.**
- The ≤200-per-set write cap.
- `DELETE /speeches/{id}/annotation-sets/me` — ⚠️ **no `authorId` parameter**, so no reviewer can construct a URL targeting a peer.

## Frontend

- Timestamp stamped on **`onBeforeInput`** guarded on `inputType.startsWith('insert')` — it covers IME and paste, and does not fire for Tab or arrows.
- Optional auto-pause on first keystroke, a per-user preference.
- The `1:23.400 ⟨ ⟩` nudge with ±0.5s steps and a duration control, **debounced at 300 ms** so a held arrow key doesn't emit twenty PATCHes.
- **750 ms debounced autosave** with a **synchronous `localStorage` mirror**.
- Live preview using **the same `OverlayStack` the speaker sees**, with `data-draft="true"`.
- The **timeline strip** — markers staggering onto a second row rather than hiding each other; the playhead as a **CSS custom property driven by rAF, never React state**.
- In-place row editing — never loading a row back into the composer, which is where the legacy `legacy/editNote.php` went wrong.
- The **6-second Undo toast** over soft delete; a `role="alertdialog"` with typed confirmation for clearing a **published** set.
- The three-tier conflict UI — **silent adopt / inline banner / never a modal** — plus the `BroadcastChannel` sibling-tab handshake.
- Autosave state as **one word**, which is also the E2E test hook.
- The publish confirmation carries §6.11's notice that the speaker may later show this feedback, anonymized, to a reviewer of a newer version.

## Deliberately stubbed

No voice notes ([step 10](STEP-10-voice-annotation.md)). No captions ([step 09](STEP-09-captions.md)). The essay tab is still disabled ([step 08](STEP-08-essay.md)).

## Containers introduced

None.

## Acceptance

- [ ] A Coach annotates at three timestamps, two overlapping; the speaker replays and sees **step 06's behaviour unchanged against real rows**
- [ ] ⚠️ **Ten body-only keystrokes produce zero `addCue`/`removeCue` calls** — asserted with a spy. The timing-signature rule is the difference between a working preview and one that storms `cuechange` every 750 ms
- [ ] Two tabs editing the same annotation: clean adopts silently, dirty banners, **and the local text is never discarded**
- [ ] Delete-then-Undo restores it, **and re-creating with the same `client_uuid` does not collide**
- [ ] `clearAnnotations` empties the set and **leaves the review, the access grant and the acceptance record intact**
- [ ] Deleting a speech mid-annotation returns **410 Gone**, not 404, and the client shows "your draft is preserved below"

## Watch for

**On the 06/07 split.** Building these as one phase is a legitimate alternative that recovers 0.5–1 week and gives up the early flagship demo. The seam is the `annotations:seed` command, which is discarded either way — so re-merging is clean if you'd rather.

**Do not parallelize 06 and 07** across two developers. They share the overlay component and the store shape, and two people writing `useTimedAnnotations` and the composer simultaneously produce two disagreeing normalizations — exactly the bug §8.2 exists to prevent.

---

## 🎓 Optional next: [CP-07](CP-07-flakiness.md)

| | |
|---|---|
| **Learn** | Flakiness, and why `sleep()` is a lie |
| **Track** | Playwright |
| **Time** | ~3h |

**This is optional.** [Step 08](STEP-08-essay.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
