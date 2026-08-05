# Step 15 — Accessibility and polish

**Duration:** 3–3.5 weeks · **Depends on:** [12](STEP-12-admin-portal.md), [13](STEP-13-social-layer.md) · **Unblocks:** nothing
**Plan:** [§12 S15](MODERNIZATION_PLAN.md) · [§8.6 accessibility](MODERNIZATION_PLAN.md) · [§19 testing](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished

> **Drive the entire annotation screen with a keyboard and a screen reader**, and read a before/after Axe diff proving it.

Nothing new is added here; existing things get better. The deliverable is **a screencast**, not a number.

### Demo script

1. Unplug your mouse. Open a speech.
2. Tab to the player. `Space` plays. `J`/`L` jump ±5s. `,`/`.` step ±1 frame. `[`/`]` move between annotations.
3. Open the authoring surface. `C` stamps a timestamp **inside the textarea** — it is the core action, so it lives where your hands are.
4. Tab across the timeline markers with a **roving tabindex**. Each announces *"Annotation at 1 minute 23 seconds"* — ⚠️ **never bare "1:23"**, which screen readers pronounce as a ratio.
5. Turn on a screen reader. **The overlay stays silent** — it is `aria-hidden="true"` by default, because a live region firing every few seconds over playing speech audio is a denial of service, not an accessibility feature.
6. Instead, read the **transcript list** — the authoritative accessible surface. Chronological, timecoded, `aria-current` on the playing row.
7. Turn on "announce commentary aloud" (off by default). At most one announcement per 2s, never `assertive`, and paired with **"pause video while announcing"** — because you cannot announce over speech audio without losing one of them.
8. **Notice that focus never moves to the playing row.** That would trap a keyboard user in a moving target.
9. Run Axe. Compare with the run you saved before this step. Read the diff.
10. Run `php artisan capability:matrix`. **Every cell green or asserted-absent.**

## Backend

- Query-count assertions on the three flagship endpoints.
- Load check on the annotation payload.

## Frontend

- WCAG 2.2 AA including ⚠️ **real screen-reader testing** — Axe catches roughly a third of real issues, so the automated number is a **floor, not a result**.
- Responsive verification across the annotation, playback, profile and timeline surfaces. (The legacy app had **no viewport meta tag at all**; building mobile-first from step 03 is what avoids a retrofit here.)
- The §8.6 keyboard map in full.
- Error boundaries and empty states everywhere they were skipped.

## Deliberately stubbed

No designer-led visual pass — §12's exclusion stands. No i18n.

**No Playwright** — though every hook it will need already exists: `data-visible`, the curated `data-testid` module, every async state as a stable DOM attribute, the `E2ESeeder`, the `login-as` route and the `FakeTranscoder` binding. Adding it later is **not a refactor**.

## Containers introduced

None.

## Acceptance

- [ ] ⚠️ **No critical Axe violations on the annotation, playback or profile screens**
- [ ] The player is **fully keyboard-operable**
- [ ] **Lighthouse mobile ≥ 90**
- [ ] The capability-matrix meta-test flips to **zero-pending-allowed** and passes
- [ ] Every §7.1 cell is **green or asserted-absent**
- [ ] A screencast exists of the annotation screen driven entirely by keyboard and screen reader

## Watch for

**`data-visible` is a test contract, not an implementation detail.** It exists for the fade (§5.4) and it means cue timing can be asserted **without touching opacity, animation timing or pixels**. Write that down in the code, or someone will refactor it away.

**Never select on Tailwind classes.** Make that a review rule.

⚠️ **The transcript list — not the overlay — is the authoritative accessible surface.** That is the load-bearing accessibility decision in this product, and it directly serves the "chronological and linear" requirement for users who cannot perceive the overlay. If you have time for one thing here, make that list excellent.

---

## 🎓 Optional next: [CP-15](CP-15-accessibility-gates.md)

| | |
|---|---|
| **Learn** | Accessibility as a gate |
| **Track** | Playwright |
| **Time** | ~3h |

**This is optional.** nothing — you're at the end does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
