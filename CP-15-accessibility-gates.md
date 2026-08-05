# CP-15 — Accessibility as a gate

> **Optional.** This is the last checkpoint — there is no step after it.

**Track:** Playwright · **Time:** ~3h · **After:** [Step 15](STEP-15-accessibility.md) · **Then:** you're done.

---

## 🎯 What you are learning here

1. How to wire automated accessibility checks into CI as a **gate**, not a report nobody reads.
2. **What automated checking can and cannot detect** — and why that ratio matters more than the tooling.
3. Why "no violations" and "accessible" are different claims.
4. How to scope a scan so third-party components don't force you to disable rules globally.

---

## Why automate it at all, given the limits

Start with the honest number: **automated accessibility tools catch roughly a third of real issues.** §8.6 says so, and Step 15 repeats it.

So why bother?

**Because that third is the part that regresses silently.** A missing button label, an image with no alt text, a contrast ratio that drops when someone tweaks a colour — these get introduced constantly, by well-meaning changes, and nobody notices. A gate catches them at the PR, when fixing costs a minute.

**What it cannot catch is the part that requires judgment:** whether your focus order makes sense, whether an announcement is *useful* rather than merely present, whether a screen reader user can actually complete the task. No tool can assess those, because they're about meaning.

> **The framing that keeps this honest:** automated checks are a **floor, not a result.** They stop things getting worse. They do not tell you it's good.
>
> **This is why step 5 below exists.** Finding one real problem the tool missed is what stops "green build" from turning into "accessible product" in your head.

---

## Setup — in order

### 1. Add axe to your suite

```bash
npm i -D @axe-core/playwright
```

```ts
import AxeBuilder from '@axe-core/playwright';

test('the annotation screen has no critical violations', async ({ page }) => {
  await page.goto('/speeches/seeded/watch?review=1');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const serious = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );

  // WHY log before asserting: the failure message alone is unreadable.
  // This prints the rule, the impact, and the element.
  if (serious.length) console.log(JSON.stringify(serious, null, 2));

  expect(serious).toEqual([]);
});
```

**Why filter to critical and serious:** axe reports four levels. Failing on `minor` produces noise you'll learn to ignore — which is the same decay problem as flaky tests ([CP-07](CP-07-flakiness.md)). Gate on what genuinely blocks someone.

### 2. Scan the three screens Step 15 names

Annotation, playback, profile. Not everything — these are the ones that matter and the ones you'll actually maintain.

### 3. Break it deliberately

Remove a button's accessible name:

```tsx
<button onClick={save}><SaveIcon /></button>   {/* no text, no aria-label */}
```

Run. **It fails**, naming the rule (`button-name`) and the element. Fix it with `aria-label`.

### 4. Scope around third-party components

You'll get violations from components you don't control — Video.js, Filament, a date picker.

**Scope the scan rather than disabling the rule:**

```ts
const results = await new AxeBuilder({ page })
  .include('[data-testid="annotation-panel"]')     // only your code
  .exclude('.video-js')                            // known third-party
  .analyze();
```

**Why scope rather than disable:** `.disableRules(['color-contrast'])` turns the rule off *everywhere*, including your own code where it would have caught something. Excluding a selector is narrow and honest — and it leaves a visible marker of what you consciously excluded.

### 5. Now find something axe missed — the important step

Turn on a screen reader (VoiceOver on macOS: ⌘F5) and use the annotation screen **without looking at it.**

**Write down one real problem the automated scan did not catch.**

You will find one. Common candidates in a product like this:

- The reading order makes no sense even though the DOM is valid.
- A button is labelled "Edit" — technically correct, useless when there are twelve of them.
- Something updates visually with no announcement at all.
- Focus lands somewhere unhelpful after an action.
- The transcript list is technically navigable but exhausting to move through.

**This is the deliverable of this checkpoint**, more than the CI gate. It's what converts "axe catches a third" from a statistic you read into a thing you have seen.

---

## The nuances

**Axe scans the DOM at a moment in time.** For a screen whose whole point is changing over time ([CP-06](CP-06-testing-time-based-ui.md)), scan more than once — with an annotation visible, and without.

**`aria-hidden` regions are skipped**, which is correct and worth knowing here: §8.6 deliberately sets `aria-hidden="true"` on the annotation overlay, because a live region firing every few seconds over playing speech audio is a denial of service rather than a feature. **Axe will therefore never scan it — by design.** The transcript list is the surface that matters, and that's what to scan.

**Colour contrast needs real rendering.** It fails or misreports on elements not actually visible. Make sure the state you want checked is on screen.

**Don't gate on the violation *count*.** Ratchets like "no more than 5" get gamed and drift. Gate on severity.

---

## ⚠️ You will hit this

**A wall of violations on the first run.** Normal. Triage by impact, fix critical and serious, and note the rest.

**Third-party violations you can't fix.** Scope around them, and record why.

**A green build feels like done.** It isn't. That's what step 5 is for.

**VoiceOver is disorienting at first.** That's information — if it's hard for you with sight and context, consider the experience without either.

---

## Done when

- [ ] CI fails on a critical violation — **proven by introducing one**
- [ ] The three Step 15 screens are scanned
- [ ] Third-party components are **scoped around, not rule-disabled**
- [ ] ⭐ **You have one written-down example of a real problem axe did not catch**

Understanding:

- [ ] Why automate at all if it catches only a third?
- [ ] Why gate on impact rather than count?
- [ ] Why does axe never scan the annotation overlay, and why is that correct?
- [ ] Why scope a scan instead of disabling a rule?
- [ ] What's the one thing you found that the tool didn't?

---

## You've finished the track

Sixteen checkpoints. Worth naming what you now have, because it's more than a test suite:

**CI/CD:** a workflow you wrote from scratch, deployment with secrets and environments, service containers, caching, matrices, sharding with merged reports, and branch protection that can stop you.

**Playwright:** codegen and — more importantly — why you refactor its output, selector strategy, traces, multi-context security tests, time-based UI, flakiness diagnosis, rich-text and device faking, isolation and parallelism, visual regression, and accessibility gates.

**And the transferable half**, which outlasts all of these tools: measure before optimizing · wait for conditions, never for time · make wrong things impossible rather than forbidden · know what your automation *cannot* cover and write it down.

---

**Back to:** [LEARNING-TRACK.md](LEARNING-TRACK.md) · [STEPS.md](STEPS.md)
