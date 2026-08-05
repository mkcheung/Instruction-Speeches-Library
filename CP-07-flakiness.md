# CP-07 — Flakiness, and why `sleep()` is a lie

> **Optional.** [Step 08](STEP-08-essay.md) does not depend on this.

**Track:** Playwright · **Time:** ~3h · **After:** [Step 07](STEP-07-write-commentary.md) · **Then:** [Step 08](STEP-08-essay.md)

---

## 🎯 What you are learning here

1. **Why a flaky test is worse than no test** — this is the central idea, not a slogan.
2. The difference between waiting for **time** and waiting for a **condition**.
3. Why every `waitForTimeout` is a bug you deferred.
4. What retries actually do, and why they belong in CI only.
5. **How to diagnose flakiness** rather than paper over it.

---

## Why flaky is worse than absent

A test that fails 5% of the time seems better than no test. It isn't, and the reason is about people rather than software.

**What actually happens:** the suite goes red. You know it's "probably that flaky one." You re-run it. It's green. You move on.

You have just taught yourself that **red doesn't mean broken.** And you'll apply that lesson the day red means something.

Worse, it's contagious. Once one test is known-flaky, every failure gets the benefit of the doubt. A suite with a few flaky tests provides *negative* value: it costs time to run, it costs time to re-run, and it has stopped being a signal.

> **The rule worth internalizing:** a test suite's value is not how much it covers. **It's whether you believe it.** Delete a flaky test rather than tolerate it — at least then you know what you don't have.

---

## Why `sleep` is a lie

`waitForTimeout(500)` says: *"I believe this will be ready in 500ms."*

That belief is wrong in both directions:

- **Too short** on a loaded CI runner, a cold cache, or a slow database. The test fails for no real reason.
- **Too long** the other 99% of the time. Multiply by a few hundred tests and your suite takes minutes it didn't need.

And it's wrong in a third, worse way: **it hides what you're actually waiting for.** `waitForTimeout(500)` doesn't say whether you're waiting for a network response, an animation, or a state update. The next person can't tell, and neither can you in six weeks.

**The replacement is always the same shape:** wait for the *condition* that means "ready."

```ts
await page.waitForTimeout(1000);                                   // ✗ hope
await expect(page.getByTestId('save-status')).toHaveText('saved'); // ✓ the actual condition
```

The second is **faster** (it proceeds the instant it's true), **more reliable** (it waits as long as needed), and **self-documenting**.

---

## Setup — in order

### 1. Write the authoring tests

Cover the [Step 07](STEP-07-write-commentary.md) surface: type at a timestamp, nudge it, autosave, publish.

### 2. Find the flakiness

```bash
npx playwright test --repeat-each=10
```

**Something will fail.** The 750ms autosave debounce is the likely culprit.

**Why `--repeat-each` rather than just running it again:** flakiness is a probability, and one run tells you almost nothing. Ten runs turn "it passed" into a measurement.

### 3. Fix it properly

Step 07 renders autosave status as **one word**, deliberately, and the plan says why: *"which is also the E2E test hook."*

```ts
await page.getByTestId('annotation-body').fill('great pause here');
await expect(page.getByTestId('save-status')).toHaveText('saving');
await expect(page.getByTestId('save-status')).toHaveText('saved');
```

**Notice you can assert the intermediate state.** That's not incidental — a status that goes `idle → dirty → saving → saved` gives tests a precise thing to wait for at each stage. A spinner would give you nothing to assert on.

### 4. Add retries — CI only

```ts
retries: process.env.CI ? 2 : 0,
```

**Why not locally:** locally you *want* to see flakiness so you fix it. Retries there would hide the thing you're trying to find.

**Why in CI:** a CI failure blocks you, and infrastructure genuinely does have transient failures. Two retries turn a network blip into a delay instead of a blocked afternoon.

> ⚠️ **Retries hide flakiness; they do not fix it.** Playwright's report marks retried tests as flaky — **read that list.** If it grows, your suite is decaying, and the retries are the anaesthetic rather than the treatment.

---

## How to diagnose flakiness

A short decision tree, in the order worth trying:

**1. Does it fail more under load?** Run with `--workers=4`. If flakiness increases, it's a race or shared state ([CP-11](CP-11-isolation-and-parallelism.md)).

**2. Does it pass headed and fail headless?** Headed is slower and hides races. **The headless failure is the true one** — don't "fix" it by running headed.

**3. Where does it fail?** Turn on `trace: 'retain-on-failure'` and read it ([CP-03](CP-03-debugging-failures.md)). The trace shows the DOM at the failing moment, which usually makes it obvious.

**4. Is it the first test or a later one?** First-test failures are usually setup or cold start. Later failures are usually state left behind by earlier tests.

**Common causes, roughly in order:**

| Cause | Fix |
|---|---|
| Asserting before the app was told to act | Wait for the condition |
| `expect(await x.textContent())` instead of `await expect(x)` | Use the retrying form ([CP-01](CP-01-codegen-then-refactor.md)) |
| Shared test data | [CP-11](CP-11-isolation-and-parallelism.md) |
| Animation still running | Playwright auto-waits for stability — usually means you're asserting mid-transition |
| Network not stubbed and genuinely variable | Stub it, or wait for the response |

---

## ⚠️ You will hit this

**`waitForTimeout` will make it green**, immediately and satisfyingly. It will also make the suite slower and fail again on a loaded runner. **Every sleep is a bug you deferred.**

**You'll be tempted to raise the global timeout.** Occasionally right; usually masking. Ask what you're waiting *for* first.

**The flaky test will pass while you're watching it.** Genuinely. `--repeat-each=20` and go and do something else.

---

## Done when

- [ ] `--repeat-each=10` green across the whole suite
- [ ] **Zero `waitForTimeout` calls anywhere**
- [ ] You found one real flake and fixed the cause, not the symptom
- [ ] Retries are configured **CI-only**

Understanding:

- [ ] Why is a flaky test worse than no test? Give the *human* reason, not the technical one.
- [ ] Name three ways `waitForTimeout(500)` is wrong.
- [ ] Why retries in CI but not locally?
- [ ] A test passes headed and fails headless. Which result do you trust, and why?

---

**Next:** [Step 08 — The essay](STEP-08-essay.md), then [CP-08](CP-08-testing-rich-text.md).
