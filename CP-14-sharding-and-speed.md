# CP-14 — Sharding and wall-clock time

> **Optional.** [Step 15](STEP-15-accessibility.md) does not depend on this.

**Track:** CI · **Time:** ~3h · **After:** [Step 14](STEP-14-deploy-hardening.md) · **Then:** [Step 15](STEP-15-accessibility.md)

---

## 🎯 What you are learning here

1. Why a **slow test suite becomes a skipped test suite**, which makes speed a correctness issue.
2. The difference between **parallelism** (one machine, many workers) and **sharding** (many machines).
3. Why sharding **breaks your report**, and how merging fixes it.
4. Why four shards is **not** four times faster — and how to find where the time actually goes.
5. **Measuring before optimizing.**

---

## Why speed is a correctness problem

A ten-minute CI run seems tolerable. It isn't, and the reason is behavioural:

- You stop waiting for it and context-switch. When it fails you've moved on and have to reload the whole problem.
- You start pushing "just to see," which multiplies runs.
- Eventually somebody adds `--skip-e2e` "temporarily."

**A suite nobody waits for provides no feedback**, and feedback speed was the entire point ([CP-00](CP-00-first-workflow.md)). So speed isn't polish here — it's whether the thing works at all.

**The target worth aiming at:** under five minutes for a PR. Long enough to get coffee, short enough to still care.

---

## Parallelism versus sharding

Two different mechanisms that people conflate:

| | Parallelism | Sharding |
|---|---|---|
| **What** | Multiple workers on **one** machine | Splitting across **multiple** machines |
| **Configured by** | `--workers=4` | `--shard=1/4` |
| **Limited by** | That machine's CPU and RAM | How many runners you'll pay for |
| **Prerequisite** | Test isolation ([CP-11](CP-11-isolation-and-parallelism.md)) | Same, plus a way to merge reports |

**Use both.** Four shards × four workers = sixteen concurrent tests. But **only after CP-11**, because both multiply any shared-state bug you still have.

---

## Setup — in order

### 1. Measure first

```bash
time npx playwright test
```

**Write the number down.** You cannot claim an improvement without a baseline, and "it feels faster" is not a measurement. This is the habit, more than the technique.

### 2. Shard across runners

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]

    steps:
      - uses: actions/checkout@v7
      # ... setup, npm ci, playwright install ...

      - run: npx playwright test --shard=${{ matrix.shard }}/4
        working-directory: web

      - if: always()
        uses: actions/upload-artifact@v7
        with:
          name: blob-report-${{ matrix.shard }}
          path: web/blob-report/
          retention-days: 1
```

Config:

```ts
// WHY 'blob': a mergeable intermediate format. 'html' can't be merged.
reporter: process.env.CI ? 'blob' : 'html',
```

### 3. Merge the reports

⚠️ **Without this you have four partial reports and no overview** — which is a real regression from where you were.

```yaml
  merge-reports:
    needs: e2e
    if: always()            # WHY: you especially want the report when it failed
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
        working-directory: web

      - uses: actions/download-artifact@v8
        with:
          path: web/all-blob-reports
          pattern: blob-report-*
          merge-multiple: true

      - run: npx playwright merge-reports --reporter html ./all-blob-reports
        working-directory: web

      - uses: actions/upload-artifact@v7
        with:
          name: html-report
          path: web/playwright-report/
```

**Note what this is:** artifacts as inter-job communication, exactly as introduced in [CP-03](CP-03-debugging-failures.md). Same mechanism, different purpose.

### 4. Measure again, then find the remaining time

Compare. It will **not** be 4× faster, and the gap is the interesting part.

Look at a shard's log with timings. Typically:

| Phase | Per shard | Note |
|---|---|---|
| Checkout + setup | ~30s | **Paid by every shard** |
| `npm ci` | ~30s | Cacheable |
| `playwright install` | ~40s | **Cacheable, and usually the biggest win** |
| Actual tests | varies | The only part sharding divides |

**So: sharding divides only the test time.** Everything else is fixed cost multiplied by shard count. Four shards of a 4-minute suite with 100s of setup gives ~160s, not 60s.

**Cache the browser binaries** — usually a bigger win than another shard:

```yaml
      - uses: actions/cache@v6
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ hashFiles('web/package-lock.json') }}
```

---

## The nuances

**Playwright shards by *file*, not by test**, and it doesn't know how long each takes. One shard can get all the slow files. If shards are badly unbalanced, split large files.

**More shards eventually gets slower.** Past the point where setup dominates, you're paying fixed cost for diminishing returns. Measure; don't assume.

**`retention-days: 1` on blob reports.** They're intermediate — the merged HTML is what you keep. This matters against the 500 MB artifact ceiling ([CP-03](CP-03-debugging-failures.md)).

**`if: always()` on the merge job.** You want the report *most* when things failed.

**Sharding needs isolation even more than parallelism does.** Four machines all migrating the same database is a fast way to a confusing morning.

---

## ⚠️ You will hit this

**Four separate reports and no overview.** You skipped the merge job.

**Not 4× faster.** Setup cost. That's the lesson, not a bug.

**One shard takes twice as long.** Uneven file distribution.

**Cache miss on browsers every run.** Key on the lockfile, and check the path is right for the runner OS.

---

## Done when

- [ ] Wall-clock time **measurably** lower — with both numbers written down
- [ ] **One merged report**, not four
- [ ] Browser binaries cached
- [ ] You can say where the remaining time goes

Understanding:

- [ ] Why is a slow suite a correctness problem, not a comfort problem?
- [ ] Parallelism vs sharding — what's the difference?
- [ ] Why isn't four shards four times faster?
- [ ] Why `blob` reporter in CI and `html` locally?
- [ ] Why does sharding need CP-11's work first?

---

**Next:** [Step 15 — Accessibility and polish](STEP-15-accessibility.md), then [CP-15](CP-15-accessibility-gates.md).
