# CP-13 — Visual regression

> **Optional.** [Step 14](STEP-14-deploy-hardening.md) does not depend on this.

**Track:** Playwright · **Time:** ~3h · **After:** [Step 13](STEP-13-social-layer.md) · **Then:** [Step 14](STEP-14-deploy-hardening.md)

---

## 🎯 What you are learning here

1. What functional tests **structurally cannot** catch.
2. How screenshot comparison works, and why **baselines are the whole design**.
3. **Why your Mac baselines will fail on Linux** — and why that's about font rendering, not a bug.
4. Why visual tests are the flakiest kind, and how to keep them useful.
5. **When visual regression earns its cost, and when it doesn't.**

---

## Why functional tests can't see this

Every assertion so far checks *state*: this element exists, has this text, has this attribute.

**None of them can see that a card is 200px too tall, that text overflows its container, or that the whole layout collapses at 900px.** The DOM is correct. The test passes. It looks broken.

Visual regression closes that gap by comparing rendered pixels against an approved baseline.

**But be honest about when it's worth it.** For most screens it isn't — you'd be adding a flaky test to catch something you'd notice anyway.

> **Where it genuinely pays:** [Step 13](STEP-13-social-layer.md), because there **layout *is* the feature.** The whole step is reproducing a specific two-column arrangement from a reference screenshot: a 272px rail, a 580px feed, a 16:9 card at ~447px. If that drifts, functional tests notice nothing and the step's entire purpose has quietly failed.
>
> That's the test for whether to use this: **is the layout a requirement, or just how it happens to look?**

---

## Setup — in order

### 1. Add a screenshot assertion

```ts
test('the profile page layout is stable', async ({ page }) => {
  await page.goto('/u/seeded-user');
  await expect(page).toHaveScreenshot('profile-desktop.png');
});
```

First run **fails** and writes a baseline. That's expected — Playwright is telling you it had nothing to compare against.

### 2. Generate baselines the right way

⚠️ **This is the part everyone gets wrong, and it wastes an afternoon.**

**Baselines generated on your Mac will fail on Linux CI.** Not because anything is broken — because **font rendering genuinely differs.** Different font files, different hinting, different antialiasing, different subpixel rendering. Every glyph is a few pixels different, so every screenshot differs.

**The fix: generate baselines in the same environment CI uses.**

```bash
docker run --rm -it \
  -v $(pwd):/work -w /work/web \
  mcr.microsoft.com/playwright:v1.5x.0-noble \
  npx playwright test --update-snapshots
```

> **This is where your Docker work pays an unexpected dividend.** You containerized to learn Docker (§21); it turns out to also be the only practical way to get deterministic screenshots.
>
> ⚠️ **On Apple Silicon that image is `linux/arm64`** — which, per [CP-04](CP-04-services-and-caching.md), is a *different Chromium* from the x64 one CI runs. Rendering may still differ. If it does, generate baselines in CI itself: run with `--update-snapshots` on a branch and commit what it produces.

### 3. Commit the baselines

They go in git, next to the tests. They are **reviewed artifacts** — when one changes, that change should appear in a PR diff and get looked at. That's the point: an intentional design change updates the baseline; an accidental one gets caught.

### 4. Break it deliberately

Change a padding value by 5px. Run.

**It fails**, and the HTML report shows three images: **expected, actual, and a diff** with changed pixels highlighted. Open it. That diff view is the payoff.

### 5. Mask what legitimately changes

```ts
await expect(page).toHaveScreenshot('profile.png', {
  mask: [
    page.getByTestId('relative-timestamp'),   // "3 hours ago" changes constantly
    page.getByTestId('avatar-image'),         // seeded avatars may vary
  ],
  maxDiffPixelRatio: 0.01,                    // tolerate ~1% — antialiasing
  animations: 'disabled',                     // freeze CSS animations
});
```

**Why each:**
- **`mask`** paints boxes over regions that are *supposed* to change. Without it, a relative timestamp fails your test every hour.
- **`maxDiffPixelRatio`** — demanding pixel-perfection guarantees flakiness. A small tolerance catches layout shifts while ignoring antialiasing noise.
- **`animations: 'disabled'`** — otherwise you screenshot a random frame of a transition.

---

## The nuances

**Screenshot the smallest thing that matters.** Full-page shots fail for any change anywhere. Prefer an element:

```ts
await expect(page.getByTestId('timeline-card')).toHaveScreenshot('card.png');
```

Smaller scope = fewer false failures = a test you keep.

**Viewport size must be fixed.** Set it explicitly in the config; a differing default breaks everything.

**Fonts must load before the shot.** A screenshot mid-font-load captures fallback rendering. `await document.fonts.ready` in an evaluate, or wait for a known element.

**Update baselines deliberately, never reflexively.** `--update-snapshots` after every failure defeats the entire purpose — you've built a test that always passes. When one fails, **look at the diff first**, then decide.

**These are the flakiest tests you will write.** Budget for maintenance, and use them sparingly — Step 13's layout, maybe the annotation overlay. Not every screen.

---

## ⚠️ You will hit this

**Everything fails on the first CI run.** Baselines were made on macOS. This is the lesson.

**A test fails and the diff shows nothing visible.** Antialiasing. Raise `maxDiffPixelRatio` slightly.

**A timestamp fails your test hourly.** Mask it.

**You'll be tempted to `--update-snapshots` to make red go away.** That converts a real signal into a rubber stamp.

---

## Done when

- [ ] A deliberate 5px change **fails the build**
- [ ] You viewed the expected/actual/diff images
- [ ] Baselines are generated in a **Linux container**, not on macOS
- [ ] Volatile regions are masked
- [ ] Baselines are committed and appear in PR diffs

Understanding:

- [ ] Name a bug functional tests structurally cannot catch.
- [ ] Why do Mac baselines fail on Linux? Be specific.
- [ ] Why is `maxDiffPixelRatio: 0` a bad idea?
- [ ] Why is visual regression right for Step 13 but wrong for most screens?
- [ ] What's wrong with running `--update-snapshots` whenever a test goes red?

---

**Next:** [Step 14 — Deploy hardening](STEP-14-deploy-hardening.md), then [CP-14](CP-14-sharding-and-speed.md).
