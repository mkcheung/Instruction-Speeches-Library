# CP-09 — Matrix builds

> **Optional.** [Step 10](STEP-10-voice-annotation.md) does not depend on this.

**Track:** CI · **Time:** ~2h · **After:** [Step 09](STEP-09-captions.md) · **Then:** [Step 10](STEP-10-voice-annotation.md)

---

## 🎯 What you are learning here

1. How to run the same job across variations **without duplicating it**.
2. **`fail-fast`** — the default that will confuse you, and why it exists anyway.
3. How to add one-off combinations with `include`.
4. **How to choose a matrix axis that teaches you something**, rather than one that just costs minutes.

---

## Why matrices exist

You want to know your app works on three browsers. The naive approach is three nearly-identical jobs — and now every change has to be made three times, and they drift.

A matrix declares the *variation* and lets CI generate the jobs:

```yaml
strategy:
  matrix:
    browser: [chromium, firefox, webkit]
```

Three jobs, one definition, running in parallel. Add a fourth browser by adding a word.

**The deeper point:** a matrix makes the axis of variation *explicit*. Reading the workflow tells you what your project claims to support. Three copy-pasted jobs tell you nothing except that someone copy-pasted.

---

## Setup — in order

### 1. The browser matrix

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    strategy:
      # WHY false: see below. This is the one that will confuse you.
      fail-fast: false
      matrix:
        browser: [chromium, firefox, webkit]

    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'npm'

      - run: npm ci
        working-directory: web

      # WHY --with-deps: Linux runners lack the system libraries browsers need.
      # WHY only this browser: installing all three wastes minutes per job.
      - run: npx playwright install --with-deps ${{ matrix.browser }}
        working-directory: web

      - run: npx playwright test --project=${{ matrix.browser }}
        working-directory: web

      - if: always()
        uses: actions/upload-artifact@v7
        with:
          # WHY the browser in the name: artifacts collide otherwise and
          # you get one report instead of three.
          name: report-${{ matrix.browser }}
          path: web/playwright-report/
```

Your config needs the projects to exist:

```ts
projects: [
  { name: 'setup', testMatch: /.*\.setup\.ts/ },
  { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
  { name: 'firefox',  use: { ...devices['Desktop Firefox'] }, dependencies: ['setup'] },
  { name: 'webkit',   use: { ...devices['Desktop Safari'] },  dependencies: ['setup'] },
],
```

### 2. Watch `fail-fast` bite

**Leave `fail-fast` at its default (true) for the first push.** Something will fail — usually WebKit — and GitHub will **cancel the other two jobs.**

You'll look at the run and think Firefox passed. It didn't run.

Now set `fail-fast: false` and push again. **Three independent results.**

**Why the default is `true`:** for expensive matrices, if one combination is broken the rest usually are too, and cancelling saves money. **Why you want `false` here:** you're learning, and you want the full picture per run rather than fixing one thing at a time across five pushes.

### 3. Add a one-off with `include`

Given [CP-04](CP-04-services-and-caching.md), the genuinely interesting axis for this app is **architecture, not browser**:

```yaml
    strategy:
      fail-fast: false
      matrix:
        include:
          - runner: ubuntu-latest      # x64 — Chrome for Testing, HAS H.264
            name: x64
          - runner: ubuntu-24.04-arm   # arm64 — open-source Chromium, NO H.264
            name: arm64
    runs-on: ${{ matrix.runner }}
```

Run the video-playback test on both. **One passes, one fails.**

That is a more instructive matrix than three browsers doing the same thing, because it demonstrates something true about your stack that you would otherwise only discover by accident.

---

## The nuances

**`--with-deps` installs system libraries, and is Linux-only in effect.** On macOS it's a **verified no-op** — exits 0, prints nothing. Not an error, just nothing to do. Harmless to leave in a cross-platform script.

**Install only the browser you're testing.** `npx playwright install` with no argument fetches all three. In a matrix that's three times the download for one browser's use.

**⚠️ Artifact names must be unique per matrix job.** Without `${{ matrix.browser }}` in the name, jobs overwrite each other and you get one report.

**WebKit is where you'll find real bugs.** It's the engine behind Safari, and it's the one that behaves differently. R1 in the plan's risk register is a WebKit concern — this is how you'd catch it automatically.

**Matrix jobs multiply cost.** Three browsers = three times the minutes. On a public repo that's free; on a private one it counts. Consider running the full matrix on `main` and only chromium on PRs.

---

## ⚠️ You will hit this

**"Two jobs passed" — they were cancelled.** `fail-fast`. Read the run summary carefully; cancelled and passed look similar at a glance.

**WebKit fails on something real.** Good. That's the whole point of the matrix. Common culprits: date parsing, CSS features, and media behaviour.

**Only one artifact appears.** Name collision.

**arm64 runners may have different availability.** Check before designing around them.

---

## Done when

- [ ] Three browsers running in parallel from one job definition
- [ ] You hit the `fail-fast` cancellation **and understood what you were looking at**
- [ ] You found and fixed at least one genuine cross-browser difference
- [ ] Artifacts are named per matrix job
- [ ] You ran the architecture matrix and watched the codec difference appear

Understanding:

- [ ] What does a matrix give you over three copy-pasted jobs?
- [ ] Why does `fail-fast` default to true if it's confusing?
- [ ] Why install only one browser per job?
- [ ] Why is the architecture axis more interesting than the browser axis *for this app*?

---

**Next:** [Step 10 — Voice annotation](STEP-10-voice-annotation.md), then [CP-10](CP-10-faking-devices.md).
