# CP-11 — Test isolation and parallelism

> **Optional.** [Step 12](STEP-12-admin-portal.md) does not depend on this.

**Track:** Playwright · **Time:** ~4h · **After:** [Step 11](STEP-11-privacy-erasure.md) · **Then:** [Step 12](STEP-12-admin-portal.md)

---

## 🎯 What you are learning here

1. Why **E2E tests have side effects** and unit tests don't — and why that changes everything about how you write them.
2. What **test isolation** means, and the three ways to achieve it.
3. Why **random-looking failures are a diagnosis**, not a mystery.
4. What **order dependency** is, and why a suite that only passes in one order is broken even when green.

---

## Why this is the problem that eventually bites everyone

A unit test calls a function and checks the return. Run it a thousand times in any order — same result. It has no side effects.

**An E2E test creates a user. Uploads a video. Sends an invitation. Those persist.**

So E2E tests are not independent by default. They share a database, and they can interfere with each other:

- Test A creates `mars@example.com`. Test B creates `mars@example.com`. **B fails** — and it's B's fault only in the sense that it went second.
- Test A seeds a speech and asserts "1 speech." Test B also seeds one. **Now A sees 2.**
- Test A deletes an account that test B was about to use.

Run them serially and it's fine, mostly, by accident. **Run them in parallel and it collapses** — and the failures move around, because worker scheduling isn't deterministic.

> **The insight worth internalizing:** when tests fail *differently each run*, that randomness is not noise. **It is the diagnosis.** It means shared state, essentially always.

---

## Three ways to isolate, and when each is right

| Approach | How | Good | Bad |
|---|---|---|---|
| **Unique data per test** | Timestamp/UUID in every value | Simple, no infrastructure | Database grows forever; "count all" assertions impossible |
| **Transaction rollback** | Each test in a transaction, rolled back | Fast, perfectly clean | ⚠️ **Does not work for E2E** — see below |
| **Database per worker** | Worker 1 → `test_1`, worker 2 → `test_2` | True isolation, parallel-safe | Setup cost, N databases to migrate |

> ⚠️ **Why transaction rollback doesn't work here**, even though it's the standard answer for backend tests: your test runs in **Playwright's** process; your app runs in **PHP's**. Different processes, different connections. Playwright cannot open a transaction that the app's queries participate in.
>
> This surprises people coming from Laravel's `RefreshDatabase`, which works precisely because the test and the app share a process. **Know why the familiar tool doesn't apply.**

**For this project: database per worker**, with unique data inside each as a second layer.

---

## Setup — in order

### 1. Watch it break

```bash
npx playwright test --workers=4
```

**Things that passed serially will fail.** Note *which* — and run it again and note that **it's a different set**. That difference is the signal.

### 2. A database per worker

Playwright exposes a worker index. Use it:

```ts
// tests/fixtures.ts
import { test as base } from '@playwright/test';

export const test = base.extend<{}, { workerDb: string }>({
  workerDb: [async ({}, use, workerInfo) => {
    const db = `test_${workerInfo.workerIndex}`;
    await createAndMigrate(db);      // your helper
    await use(db);
    await drop(db);
  }, { scope: 'worker' }],           // WHY worker scope: once per worker, not per test
});
```

Your app needs to route to the right database — usually a header the test sends and middleware reads, enabled only in the test environment.

### 3. Use the seeder properly

[Step 01](STEP-01-identity.md) specifies `E2ESeeder` with **fixed ids and literal timestamps, never `now()`.**

**This is why.** A seeder using `now()` produces different data every run, so:
- You cannot assert on dates.
- "The oldest invitation" changes between runs.
- A failure at 23:59 may not reproduce at 09:00.

**Fixed data makes failures reproducible**, which is the entire property you need when something breaks in CI at 3am.

### 4. Test erasure — safely

Step 11's erasure is the most destructive operation in the app. It **must** be isolated, or it deletes data other tests were relying on and you spend a day blaming the wrong code.

---

## The nuances

**Playwright's default parallelism:** files run in parallel, tests *within* a file run serially. So two files touching the same user collide even at default settings.

**`test.describe.serial()`** forces a group to run in order — and it's usually the wrong fix. It papers over shared state and it makes your suite slower. Use it only when the tests genuinely model a sequence.

**Worker count is not thread count.** Each worker is a process with its own browser. More workers = more memory. Four is a sensible ceiling on a laptop; CI runners vary.

**Storage state from [CP-05](CP-05-two-users-one-test.md) interacts with this.** If all workers share one auth file, they share a user — which may be fine for read-only tests and is definitely not fine for anything mutating.

**Order dependency is a bug even when green.** If your suite only passes in one order, you have a hidden dependency that will surface the moment a test is added, removed or renamed. `--shuffle` (if available) or reordering by hand will find it.

---

## ⚠️ You will hit this

**The failures look random.** Different tests each run. **That randomness is the diagnosis** — it means shared state, not flaky infrastructure.

**Passes at `--workers=1`, fails at 4.** Same diagnosis. Do not "fix" it by pinning to one worker; that's giving up parallelism to hide a real bug.

**Database-per-worker is fiddly the first time.** Migrating N databases at startup is slow. Migrate one and template it, or keep a pre-migrated snapshot.

**Your seeded IDs collide across workers.** Fixed IDs are good for reproducibility and mean worker 1 and worker 2 use *the same* IDs — fine when the databases are separate, broken if they aren't.

---

## Done when

- [ ] `--workers=4` green, **repeatedly**
- [ ] You can explain what each worker's data looks like
- [ ] Erasure tests are isolated and don't affect other tests
- [ ] The seeder uses **fixed ids and literal timestamps**

Understanding:

- [ ] Why don't unit tests have this problem?
- [ ] Why can't you use transaction rollback the way Laravel's `RefreshDatabase` does?
- [ ] Your tests fail differently each run. What does that tell you, specifically?
- [ ] Why is `test.describe.serial()` usually the wrong fix?
- [ ] Why must the seeder avoid `now()`?

---

**Next:** [Step 12 — Admin portal](STEP-12-admin-portal.md), then [CP-12](CP-12-required-checks.md).
