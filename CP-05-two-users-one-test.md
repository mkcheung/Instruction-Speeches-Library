# CP-05 — Two users in one test

> **Optional.** [Step 06](STEP-06-watch-commentary.md) does not depend on this.

**Track:** Playwright · **Time:** ~4h · **After:** [Step 05](STEP-05-invitation-loop.md) · **Then:** [Step 06](STEP-06-watch-commentary.md)

---

## 🎯 What you are learning here

1. The difference between **browser, context and page** — and why context is the one that matters.
2. **`storageState`**: logging in once instead of once per test, and why that's the biggest speed win available.
3. Why the **setup-project pattern** replaced `globalSetup`.
4. **How to test that something is *not* possible** — a different skill from testing that something works.
5. Why security rules are the single best use of E2E testing.

---

## Why this is the best kind of E2E test

Most E2E tests assert that a feature works. Those are useful and a bit boring — a feature that doesn't work gets noticed quickly by a human.

**Security rules are the opposite.** When reviewer isolation breaks, *nothing looks wrong*. No error, no crash, no visual glitch. Reviewer A simply sees something they shouldn't, and nobody notices until it matters.

Worse, these rules break during **unrelated** work. Someone refactors a query, drops a `where` clause, and the isolation quietly stops holding. No test at the unit level catches it — the query still returns rows, just too many.

**This is exactly where E2E earns its cost.** It's the only kind of test that can express *"log in as this person, try this, and confirm you can't."*

Step 05's requirement is precise, and worth re-reading:

> Reviewer A cannot read Reviewer B's review **and cannot see that B exists.**

That second clause is the interesting one. Even the *count* leaks — §7.3 says so — because "three people are reviewing this" changes what a reviewer writes.

---

## The model: browser → context → page

This is the concept people get wrong, and it produces a specific confusing bug.

| Thing | Is | Holds |
|---|---|---|
| **Browser** | One running process | Nothing user-specific |
| **Context** | An isolated profile | **Cookies, localStorage, session** |
| **Page** | A tab | Its own URL, shares the context's cookies |

> **Two pages in one context are two tabs logged in as the same person.**
>
> **Two contexts are two different people.**
>
> If you write a "two users" test with two `page` objects from the same context, **both users are the same user** and your test passes for the wrong reason — which is worse than failing.

---

## Setup — in order

### 1. Log in once per role, not once per test

Logging in is slow, and doing it in every test is the most common reason suites become unbearable. `storageState` saves the cookies after one login and replays them.

**Use a setup *project* with `dependencies`** — this is now the explicitly recommended approach, and `globalSetup` is no longer the documented path. Most tutorials you'll find still teach the old way.

`tests/auth.setup.ts`:

```ts
import { test as setup } from '@playwright/test';

setup('authenticate as speaker', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('speaker@example.test');
  await page.getByTestId('login-password').fill('password');
  await page.getByTestId('login-submit').click();
  await page.waitForURL('/dashboard');

  await page.context().storageState({ path: 'playwright/.auth/speaker.json' });
});

setup('authenticate as reviewer A', async ({ page }) => {
  // ... same, saving to reviewer-a.json
});
```

`playwright.config.ts`:

```ts
projects: [
  { name: 'setup', testMatch: /.*\.setup\.ts/ },

  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
    dependencies: ['setup'],       // WHY: runs setup first, every time
  },
],
```

> ⚠️ **Add `playwright/.auth/` to `.gitignore`.** Those files are live session cookies. Committing them is committing credentials.

### 2. The happy path

```ts
test('an invited reviewer can watch the speech', async ({ browser }) => {
  const speaker = await browser.newContext({ storageState: 'playwright/.auth/speaker.json' });
  const reviewer = await browser.newContext({ storageState: 'playwright/.auth/reviewer-a.json' });

  const speakerPage = await speaker.newPage();
  await speakerPage.goto('/speeches/my-speech');
  await speakerPage.getByTestId('invite-open').click();
  await speakerPage.getByTestId('invite-search').fill('reviewer-a');
  await speakerPage.getByTestId('invite-send').click();

  const reviewerPage = await reviewer.newPage();
  await reviewerPage.goto('/dashboard');
  await reviewerPage.getByTestId('invitation-accept').first().click();

  await expect(reviewerPage.getByTestId('video-player')).toBeVisible();
});
```

### 3. The security test — the one that matters

```ts
test('reviewer A cannot see reviewer B exists', async ({ browser }) => {
  // both A and B have accepted on the same speech

  const a = await browser.newContext({ storageState: 'playwright/.auth/reviewer-a.json' });
  const page = await a.newPage();
  await page.goto('/speeches/shared-speech');

  // A sees their own work
  await expect(page.getByTestId('my-annotations')).toBeVisible();

  // and nothing of B's — not the content, not a count, not a name
  await expect(page.getByTestId('reviewer-list')).toHaveCount(0);
  await expect(page.getByText(/reviewer-b/i)).toHaveCount(0);
  await expect(page.getByText(/2 reviewers/i)).toHaveCount(0);

  // and cannot reach it by URL either
  const res = await page.request.get(`/api/reviews/${reviewerBReviewId}/annotations`);
  expect(res.status()).toBe(403);
});
```

### 4. Assert an endpoint's absence

Step 05 requires that **no endpoint lists reviewable speeches**. Asserting a 403 is not enough — the requirement is that the route doesn't exist.

That's a backend test walking `Route::getRoutes()`, not a Playwright test. **Knowing which tool answers which question is part of the skill.**

---

## The nuances

**`toHaveCount(0)` versus `not.toBeVisible()`.** `toHaveCount(0)` asserts the element isn't in the DOM at all. `not.toBeVisible()` passes if it's present but hidden — which, for a leak test, is **a fail dressed as a pass**: the data reached the browser, and CSS is the only thing hiding it. **For security assertions, always `toHaveCount(0)`.**

**`page.request` shares the context's cookies.** So you can make authenticated API calls as that user, in the middle of a UI test. That's how you check the endpoint directly rather than trusting the absence of a button.

**Storage state goes stale.** Change your session format and every saved file is invalid. Because it's regenerated by the setup project each run, that fixes itself — which is the main reason the setup-project pattern beats committing the files.

**Contexts are cheap.** Creating several per test is fine. They're isolated profiles, not browser processes.

---

## ⚠️ You will hit this

**Both users turn out to be the same person.** You used two pages from one context. This will confuse you for twenty minutes; now it won't.

**The setup project runs before every test run, adding a few seconds.** Correct and worth it — stale auth is a much worse failure mode than a slow start.

**Your test data needs two reviewers already attached to one speech.** Seed it via the `E2ESeeder` rather than clicking through the invitation flow twice — a test should set up by the fastest route and assert through the UI.

---

## Done when

- [ ] `storageState` is working via a **setup project**, not `globalSetup`
- [ ] A happy-path test proves the invitation grant works
- [ ] **A security test proves reviewer A cannot see B, or that B exists**
- [ ] `playwright/.auth/` is gitignored

Understanding:

- [ ] What's the difference between two pages and two contexts?
- [ ] Why is `toHaveCount(0)` the right assertion for a leak test and `not.toBeVisible()` the wrong one?
- [ ] Why is a security rule a better E2E candidate than a form-validation rule?
- [ ] Why does §7.3 say even the *count* of reviewers leaks?

---

**Next:** [Step 06 — Watch the commentary](STEP-06-watch-commentary.md), then [CP-06](CP-06-testing-time-based-ui.md).
