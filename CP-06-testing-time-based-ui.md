# CP-06 — Testing time-based UI

> **Optional.** [Step 07](STEP-07-write-commentary.md) does not depend on this.

**Track:** Playwright · **Time:** ~4h · **After:** [Step 06](STEP-06-watch-commentary.md) · **Then:** [Step 07](STEP-07-write-commentary.md)

---

## 🎯 What you are learning here

1. **How to test something that changes over time** without your test becoming a stopwatch.
2. Why you assert on **state**, never on animation or appearance.
3. **What a test contract is** — a hook that exists deliberately for testing, and why that isn't cheating.
4. How to control time instead of waiting for it.
5. **Where the boundary sits between what E2E should test and what belongs in a unit test.**

---

## Why this is the hardest testing problem in your product

*"A note appears at 1:23 and disappears six seconds later."*

Every instinct for testing that is wrong:

| Instinct | Why it fails |
|---|---|
| Play the video and wait 83 seconds | 83 seconds × many tests = an unusable suite |
| Check opacity mid-fade | You're testing CSS timing, which is not your logic |
| Screenshot at 1:24 | Fails on a slow runner where the video is at 1:22 |
| `waitForTimeout(6000)` then assert gone | Slow, and flaky the moment CI is loaded |

**The reframe that solves it:** you are not testing *time*. You are testing a **function of time** — given a playhead position, which notes should be visible?

That function is deterministic. So the E2E test's job is only: *set the position, check the state.* No waiting required.

---

## Where the boundary sits — read this before writing anything

The plan already splits this deliberately, and understanding the split is most of the lesson.

**§8.2 puts the logic in a pure function**, `computeActive(cues, t) → Set<id>`. Given a time and a list, it returns which notes are active. No video, no DOM, no browser.

| What | Tested by | Why there |
|---|---|---|
| *Which* notes are active at time `t` — boundaries, overlaps, `NaN`, negative starts, zero durations | **Vitest unit tests** | Thousands of cases in milliseconds, no browser |
| That the video's position **reaches** that function | **Playwright** | Only integration can show the wiring |
| That the right DOM nodes get marked visible | **Playwright** | Same |
| The fade itself | **Nothing.** It's CSS. | Testing it tests the browser |

> **This is the general principle, and it's worth more than the Playwright syntax:** push the *thinking* down into pure functions where testing is cheap and exhaustive, and use E2E only to prove the *wiring*.
>
> §19 says exactly this: *"the pure function carries the logic, so later E2E tests only have to prove wiring."* This checkpoint is where you feel why that was worth designing for.

---

## Setup — in order

### 1. Understand the test contract you already have

§19 states that **`data-visible` is a test contract, not an implementation detail.**

That means: the app sets `data-visible="true"` on a note's DOM node when it should be on screen, **and that attribute is a promise to tests.** Nobody may remove it in a refactor without updating tests deliberately.

**Why this isn't cheating.** You could instead assert on computed opacity — but then you'd be testing that CSS transitions work, which is the browser's job, and your test would break every time a designer changed the fade duration. The attribute expresses *intent*: "this should be showing." The CSS expresses *presentation*. Testing intent is right.

### 2. Drive the playhead directly

```ts
async function seekTo(page: Page, seconds: number) {
  await page.evaluate((t) => {
    const v = document.querySelector('video') as HTMLVideoElement;
    v.currentTime = t;
  }, seconds);
  // Wait for the app to react — an event, not a duration.
  await page.waitForFunction(
    (t) => Math.abs((document.querySelector('video') as HTMLVideoElement).currentTime - t) < 0.3,
    seconds,
  );
}
```

**Why set `currentTime` rather than pressing play:** it's instant, deterministic, and works headless where autoplay is blocked. You aren't testing that video decodes — you're testing that your app responds to a position.

### 3. Assert on state

```ts
test('annotations appear and disappear at the right times', async ({ page }) => {
  await page.goto('/speeches/seeded/watch?review=1');

  // seeded: note A at 14s for 6s, note B at 62s for 6s, note C at 64s for 6s

  await seekTo(page, 10);
  await expect(page.getByTestId('annotation-a')).toHaveAttribute('data-visible', 'false');

  await seekTo(page, 16);
  await expect(page.getByTestId('annotation-a')).toHaveAttribute('data-visible', 'true');

  await seekTo(page, 21);   // past 14 + 6
  await expect(page.getByTestId('annotation-a')).toHaveAttribute('data-visible', 'false');

  // the overlap case — both on screen at once, stacked
  await seekTo(page, 65);
  await expect(page.getByTestId('annotation-b')).toHaveAttribute('data-visible', 'true');
  await expect(page.getByTestId('annotation-c')).toHaveAttribute('data-visible', 'true');
});
```

### 4. Test scrubbing backwards

This is the case that catches real bugs — a naive implementation fires cues once and never re-arms:

```ts
test('scrubbing backwards re-activates cues', async ({ page }) => {
  await seekTo(page, 30);   // past note A
  await expect(page.getByTestId('annotation-a')).toHaveAttribute('data-visible', 'false');

  await seekTo(page, 16);   // back into it
  await expect(page.getByTestId('annotation-a')).toHaveAttribute('data-visible', 'true');
});
```

---

## The nuances

**Every node stays mounted; only the attribute changes** (§5.4). So `getByTestId('annotation-a')` always resolves — you're asserting the attribute, not presence. This is deliberate: mounting and unmounting would make the fade impossible.

**Autoplay is blocked headless.** Browsers require a user gesture. Setting `currentTime` sidesteps it entirely — but if you *do* need playback, mute the video first, since muted autoplay is generally permitted.

**Use a fixture with burned-in timecode.** A video that displays its own timestamp means a failure screenshot tells you where playback actually was. On a timing bug, that's the difference between a diagnosis and a guess.

**Don't assert the fade.** It's CSS. `data-visible` flips; the transition is presentation. If you assert on opacity you're testing the browser and you'll get flakiness for free.

**Seek precision isn't exact.** Video seeks to the nearest decodable frame, so `currentTime` after seeking to 16 might be 16.03. That's why the helper waits for *close enough* rather than equality.

---

## ⚠️ You will hit this

**The video won't play headless.** Expected. Drive `currentTime`.

**You'll want `waitForTimeout` after seeking.** Don't — [CP-07](CP-07-flakiness.md) is about exactly this. `waitForFunction` waits for the *condition*, which is both faster and correct.

**Real video decode in CI is slow and flaky.** Keep the fixture tiny and short. And remember [CP-04](CP-04-services-and-caching.md): on arm64 it may not decode H.264 at all.

**A note at exactly `0.000` behaves oddly.** §8.7 documents this for voice notes and the same boundary applies here. If your seeded data has one, you've found a real edge case — good.

---

## Done when

- [ ] A test proves the flagship feature: notes visible at the right times, overlaps stacked
- [ ] A test proves **scrubbing backwards re-activates cues**
- [ ] **No `waitForTimeout` anywhere**
- [ ] It passes ten times in a row
- [ ] `computeActive` has exhaustive **unit** coverage — separately, in Vitest

Understanding:

- [ ] Why test the *fade* nowhere?
- [ ] Why is `data-visible` a legitimate test hook rather than cheating?
- [ ] Why set `currentTime` instead of pressing play?
- [ ] Which parts of this feature belong in a unit test, and why is that the larger share?

---

**Next:** [Step 07 — Write the commentary](STEP-07-write-commentary.md), then [CP-07](CP-07-flakiness.md).
