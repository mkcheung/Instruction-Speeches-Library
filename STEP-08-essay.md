# Step 08 — The essay

**Duration:** 1.5–2 weeks · **Depends on:** [05](STEP-05-invitation-loop.md) · **Unblocks:** [11](STEP-11-privacy-erasure.md)
**Plan:** [§12 S8](MODERNIZATION_PLAN.md) · [§6.6 the essay](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished

> Write a thousand words in a real editor below the player, navigate away and be warned, come back to your draft intact, and publish it for the speaker to read beside the video.

### Demo script

1. As an invited reviewer, open the speech. There is a tab strip below the player: **`Notes | Essay`**.
2. Click **Essay**. A real word processor — bold, italic, headings, lists, links.
3. Write a few hundred words. The autosave state shows **one word**, not a spinner.
4. **Try to navigate away.** You are warned.
5. Come back tomorrow. **Your draft is exactly where you left it.**
6. Publish.
7. Log in as the speaker. Pick that reviewer's track. **Their essay is beside the video.**
8. Log in as a *different* reviewer on the same speech. **You cannot reach that essay by any route.**

## Backend

- The six essay columns on `reviews` — `essay_html` (`text`), `essay_text` derived on write, `essay_published_at`, `essay_updated_at`, `essay_words`, and a ⚠️ **separate `essay_lock_version`**.
- ⚠️ **Sanitization on write *and* on read** against the strict allowlist: `p, br, strong, em, u, s, h2, h3, blockquote, ul, ol, li, code, pre, a[href]` and nothing else. No `style`, no `class`, no `id`, no `img`. `a[href]` restricted to `http`/`https`/`mailto` with `rel="noopener noreferrer nofollow"` forced on output.
- `readAnnotations` **extended rather than paralleled** — or the two drift.
- `EssayRenderer` interface bound to `NullEssayRenderer`.

## Frontend

- The editor below the player in a **tab strip** (`Notes | Essay`).

  **Why a tab strip and not a stack:** the annotation composer stays adjacent to the player where the timestamp context lives; the essay goes underneath. The two are used in **different modes** — notes while watching, essay after. Three input surfaces competing for one screen is a real information-architecture risk, and this is the resolution.
- Autosave state as one word in both.
- Unsaved-changes guard on navigation (React Router 8 blockers).

## Deliberately stubbed

**No PDF export — the seam only**, per your explicit instruction. No collaborative editing, no comments, no tables, no images.

## Containers introduced

None.

## Acceptance

- [ ] A reviewer writes an essay, navigates away and **is warned**, returns to find the draft intact
- [ ] The speaker **cannot see it until published**
- [ ] ⚠️ **A second reviewer on the same speech cannot read it by any route** — verified by direct API call
- [ ] ⚠️ A stored-XSS payload is neutralized on write **and would still be neutralized on read if the write-time sanitizer were bypassed** — tested by writing a hostile payload **directly to the column** and fetching it
- [ ] `clearAnnotations` does **not** clear the essay
- [ ] A 30,000-word essay round-trips without truncation

## Watch for

⚠️ **Check TipTap's Pro licence boundary before designing around any extension** (R15). Some extensions are commercially licensed, which would breach the zero-cost constraint. This is flagged as **unverified** in §4's provenance table — the research agent assigned to it died before reporting. **Verify first.** The fallback is Lexical (Meta, MIT) and the swap is contained to one component.

**Why the essay lives on `reviews` rather than its own table:** it is a fourth thing a review owns, alongside the access grant, the annotation set and the playback track. Every access rule already written applies unchanged — including "reviewers may not read each other's commentary", which now covers essays too.

**The separate `essay_lock_version` is not redundancy.** The essay autosaves while annotations are being created on the same screen. Sharing one counter means every annotation write invalidates the essay editor's version and vice versa, producing spurious conflict dialogs on a screen where the user is doing both at once.

---

## 🎓 Optional next: [CP-08](CP-08-testing-rich-text.md)

| | |
|---|---|
| **Learn** | Testing a rich-text editor |
| **Track** | Playwright |
| **Time** | ~3h |

**This is optional.** [Step 09](STEP-09-captions.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
