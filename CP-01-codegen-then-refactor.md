# CP-01 — Codegen, then refactor

> **Optional.** [Step 02](STEP-02-first-deploy.md) does not depend on this.
>
> **But if you only do one checkpoint properly, do this one.** Every later Playwright checkpoint assumes the habit you build here.

**Track:** Playwright · **Time:** ~4h · **After:** [Step 01](STEP-01-identity.md) · **Then:** [Step 02](STEP-02-first-deploy.md)

---

## 🎯 What you are learning here

1. **What end-to-end tests are for** — and what they are *not* for, which matters more.
2. **What a locator is**, and why it's lazy rather than a search.
3. **Why selector choice is the entire ballgame** in E2E testing.
4. Why `await expect(...)` retries and a plain `expect(await ...)` doesn't — **and why that single distinction causes most beginner flakiness.**
5. What auto-waiting does for you, and why reaching for `sleep` means you're waiting for the wrong thing.
6. Why test data has to be unique per run.

**You are not learning the Playwright API.** You'll look that up forever, and that's fine. The transferable skills are *selector strategy* and *knowing what belongs in an E2E test* — those apply to Cypress, Selenium and whatever replaces them.

---

## Why end-to-end testing exists at all

You already have two kinds of test in the plan (§19), and it's worth being precise about why a third exists.

| Kind | Proves | Cost | Blind to |
|---|---|---|---|
| **Unit** (Vitest) | One function is correct | Milliseconds | Whether anything calls it |
| **Feature** (Pest) | One endpoint behaves | ~100ms | Whether the UI hits that endpoint |
| **E2E** (Playwright) | **The pieces connect** | Seconds | Almost nothing — and that's the problem |

**The gap E2E fills:** every unit test can pass while the product is completely broken. Your `computeActive` function is perfect. Your annotations endpoint returns correct JSON. **And the button calls the wrong URL, so nothing works.** No unit test can see that, because each one is looking at its own piece.

E2E is the only kind that exercises the real browser, the real network, the real database, and the real app — the way a person does.

**So why not write only E2E tests?** Because they are expensive in every way that matters:

- **Slow.** Seconds each, so a big suite is minutes.
- **Flaky.** More moving parts, more ways to be non-deterministic.
- **Vague on failure.** A unit test says "this function returned 3, expected 4." An E2E test says "the button wasn't there," and you get to find out why.

> **The rule this produces:** use E2E for **the few paths that must never break**, and for **things only integration reveals**. Everything else belongs lower down, where it's cheaper and clearer.
>
> For this product that means: onboarding (here), the invitation grant ([CP-05](CP-05-two-users-one-test.md)), and the annotation timing ([CP-06](CP-06-testing-time-based-ui.md)). Not "every form validates."

---

## Why codegen, and why it isn't enough

`playwright codegen` opens a browser, watches you click, and writes the test. Ninety seconds to a working E2E test — genuinely useful, and the fastest way to learn the API, because you *see* the call for every action you take.

**And its output will break constantly**, because it can only record *what you did*, not *what you meant*. It sees "clicked the element containing 'Create your account'." It cannot know that the words are incidental and the button's role is the point.

That's the whole checkpoint: **codegen gets you moving; the refactor is what makes it survive.**

---

## Setup — in order, with the reason for each

### 1. Install

```bash
cd web
npm init playwright@latest
```

Accept TypeScript and `tests/`, and let it install browsers.

### 2. Configure — read every line

`web/playwright.config.ts`. You'll return to this file at every checkpoint:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',

  // WHY: `test.only` committed by accident silently skips your whole suite
  // and CI stays green. This makes that a build failure instead.
  forbidOnly: !!process.env.CI,

  // WHY retries in CI only: retries HIDE flakiness. Locally you want to see it
  // so you fix it. In CI you want the signal without a rerun. See CP-07.
  retries: process.env.CI ? 2 : 0,

  use: {
    baseURL: 'http://localhost:5173',

    // WHY: this is what makes CP-03 possible — a recording of a failure
    // that happened on a machine you can't touch. Leave it on.
    trace: 'on-first-retry',
  },

  // WHY: ties tests to the stable hooks §19 specifies, not to markup.
  // NOTE: the codegen CLI does NOT read this file — see the nuances.
  testIdAttribute: 'data-testid',

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // WHY: the suite starts the app itself, so it works identically for you
  // and in CI. reuseExistingServer keeps your local dev loop fast.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

### 3. Record the onboarding flow

```bash
npx playwright codegen http://localhost:5173
```

Two windows: a browser, and an inspector writing code as you act.

Do the whole [Step 01](STEP-01-identity.md) flow — register, verify, names, username, avatar, land on your profile. **Watch the inspector.** That live correspondence between action and API call is the fastest API tutorial you'll get.

Copy it into `tests/onboarding.spec.ts`. Run it:

```bash
npx playwright test
```

**It passes.**

### 4. Break it deliberately

In your app, reword a heading: `"Create your account"` → `"Sign up"`. Run again.

**It fails.** Look at what codegen wrote:

```ts
await page.getByRole('heading', { name: 'Create your account' }).click();
```

That isn't a *bad* selector — role-based is the modern recommendation, and far better than the CSS paths older tools emitted. **It is still welded to your copy.** Reword text a few times, watch tests go red for no real reason, and you learn to ignore red. **A test suite you ignore is worse than none**, because it costs time and buys nothing.

### 5. Refactor to test IDs

[§19](MODERNIZATION_PLAN.md) already specifies a curated `data-testid` module. **This is what it's for.**

```tsx
<button data-testid="register-submit">Create account</button>
```

```ts
import { test, expect } from '@playwright/test';

test('a new member can register and complete onboarding', async ({ page }) => {
  await page.goto('/register');

  await page.getByTestId('register-email').fill(`mars+${Date.now()}@example.com`);
  await page.getByTestId('register-password').fill('correct-horse-battery');
  await page.getByTestId('register-submit').click();

  await expect(page.getByTestId('verify-notice')).toBeVisible();
});
```

Reword the heading again. **It passes.**

### 6. Write one by hand

Codegen records clicks; it cannot express *intent*. Write the resumable-onboarding case yourself, because it's a behaviour rather than a sequence:

```ts
test('onboarding resumes where you left off', async ({ page }) => {
  // register, complete step 1, then navigate away entirely
  await page.goto('/');

  await page.goto('/onboarding');
  await expect(page.getByTestId('onboarding-step')).toHaveText('2');
});
```

**Why by hand:** you had to decide what "resuming" *means* before you could assert it. That thinking is the part codegen can't do, and it's most of the value of a test.

---

## Why selector strategy is the whole game

Every E2E test is a bet that you can still find things after the code changes. The bet you make determines the maintenance cost:

| Selector | Breaks when… | Verdict |
|---|---|---|
| `.css-1a2b3c > div:nth-child(3)` | Any markup change at all | Never |
| `text=Create your account` | Copy changes | Fragile |
| `getByRole('button', { name: 'Save' })` | The label changes | Good default |
| `getByTestId('register-submit')` | **Someone deletes the hook deliberately** | Best for critical paths |

**Why not test IDs everywhere?** Because `getByRole` tests something real — that the element is *reachable as a button*, which is also an accessibility property. A test ID tests only that you put a string somewhere.

**The balance worth adopting:** `getByRole` by default, because it doubles as an accessibility assertion. `getByTestId` for the paths that must never break and for elements with no meaningful role. That's why §19 calls the testid module **curated** — it's a short deliberate list, not a hook on every div.

---

## The nuances — what the docs won't tell you

**Locators are lazy.** `page.getByTestId('x')` doesn't search the page — it *describes how to find* something, later, each time it's used. That's why you can create one before the element exists, and why a locator can be reused after the DOM has changed.

**Auto-waiting is doing more than you think.** `click()` waits for the element to exist, be visible, be stable (not animating), be enabled, and be able to receive events. **That's why you rarely need an explicit wait** — and why reaching for one usually means you're waiting for the wrong thing. ([CP-07](CP-07-flakiness.md) is the full treatment.)

**⚠️ The retry distinction — this causes most beginner flakiness:**

```ts
await expect(page.getByTestId('status')).toHaveText('saved');    // retries ~5s ✓
expect(await page.getByTestId('status').textContent()).toBe('saved');  // one shot ✗
```

The first is Playwright's `expect` and **polls until it passes or times out**. The second reads the text *once, immediately*, and compares — so it fails whenever the app hasn't finished yet. They look almost identical. **Prefer the first form always.**

**⚠️ The codegen CLI does not read `playwright.config.ts`.** Setting `testIdAttribute` configures your *tests*, not the *recorder*. To make codegen emit test IDs, pass `--test-id-attribute=data-testid` on the command line. Nearly everyone hits this once.

**What codegen actually prioritizes:** role → text → test ID. Good practice, still content-coupled — which is exactly why step 4 breaks it.

**Reading the verification email.** Mailpit has an HTTP API; query it from the test rather than trying to automate a mail client:

```ts
const res = await request.get('http://localhost:8025/api/v1/messages');
```

---

## ⚠️ You will hit this

**"It passed once and now always fails."** You created a user; usernames are unique. `Date.now()` is the crude fix; [CP-11](CP-11-isolation-and-parallelism.md) does it properly. **Note what this is teaching you: E2E tests have side effects.** Unit tests don't, which is why this surprises people.

**Passes headed, fails headless.** Almost always a race — headed is slower, which hides it. The headless failure is the true one.

**Codegen records too much.** It captures stray clicks. Delete the noise: a test should read like a description of intent, not a transcript.

---

## Done when

Mechanics:

- [ ] One test recorded with codegen, then **refactored to test IDs**
- [ ] You broke it by rewording copy and fixed it by changing selectors — **and watched both happen**
- [ ] One test written by hand covering resumable onboarding
- [ ] Both pass headless

Understanding — **answer these out loud**:

- [ ] Why not write everything as E2E tests, since they're the most realistic?
- [ ] What does `getByRole` assert that `getByTestId` does not?
- [ ] Why does `await expect(x).toHaveText('y')` behave differently from `expect(await x.textContent()).toBe('y')`?
- [ ] What does "locators are lazy" mean, and why is it useful?
- [ ] Your test passed once and now fails every time. What happened, and why don't unit tests have this problem?

---

## Going deeper (optional)

```bash
npx playwright test --ui       # time-travel debugger. Genuinely excellent.
npx playwright test --debug    # step through line by line
npx playwright show-report     # the HTML report after a run
```

**Spend twenty minutes in `--ui` mode.** Timeline, DOM at each step, every locator highlighted. It is the fastest way to build an accurate model of what Playwright is actually doing, and it will save you hours later.

---

**Next:** [Step 02 — First deploy](STEP-02-first-deploy.md), then [CP-02](CP-02-deployment-and-secrets.md).
