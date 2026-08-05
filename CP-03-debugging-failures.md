# CP-03 — Debugging a failure you cannot see

> **Optional.** [Step 04](STEP-04-every-video-plays.md) does not depend on this.

**Track:** Playwright + CI · **Time:** ~3h · **After:** [Step 03](STEP-03-upload-and-watch.md) · **Then:** [Step 04](STEP-04-every-video-plays.md)

---

## 🎯 What you are learning here

1. **Why "add a console.log and push again" is a trap**, and what replaces it.
2. What a **trace** actually contains, and why it beats logs and even video.
3. What **artifacts** are, and why jobs need them to communicate at all.
4. **`if: always()`** — the single most common CI mistake, and why it happens.
5. That artifact **storage**, not minutes, is the free-tier limit that bites first.

---

## Why this exists

A test fails on a machine that no longer exists. You cannot open DevTools on it. You cannot add a breakpoint. The machine was destroyed the moment the job ended.

The obvious response is to add a `console.log` and push again. **That loop is five to ten minutes per iteration**, and each iteration tells you one thing. Debugging that way turns a twenty-minute problem into an afternoon.

**The alternative: make the failure leave evidence behind.** Playwright can record everything the browser did — DOM at every step, every network request, console output, screenshots before and after each action — and hand it to you as a file. You then debug locally, at your own pace, as many times as you like, from a single failed run.

> **The general principle, worth carrying beyond testing:** when you can't reach the environment, make the environment ship you a recording. It's the same instinct behind structured logging and error tracking (§14's GlitchTip).

---

## Setup — in order

### 1. Turn on tracing

Already in your config from [CP-01](CP-01-codegen-then-refactor.md):

```ts
use: {
  trace: 'on-first-retry',
}
```

**Why `on-first-retry` rather than `on`:** traces are large. Recording every passing test fills your artifact quota in days. `on-first-retry` records only when something already failed once — you pay for evidence exactly when you need it.

Other values: `off`, `on`, `retain-on-failure`.

### 2. Upload it

```yaml
      - name: Run Playwright
        working-directory: web
        run: npx playwright test

      - name: Upload test artifacts
        if: always()          # ⚠️ THE LINE. See below.
        uses: actions/upload-artifact@v7
        with:
          name: playwright-report
          path: |
            web/playwright-report/
            web/test-results/
          retention-days: 7   # WHY: storage is the real quota
```

### 3. Break it in a CI-only way

Don't break it in a way that also fails locally — that defeats the exercise. Good options:

- Assert on a **date format**. Your Mac and the Linux runner have different locales.
- Assert on something **timing-dependent**. CI runners are slower and more variable.

### 4. Download and open the trace

From the failed run's summary page, download the artifact. Then:

```bash
npx playwright show-trace path/to/trace.zip
```

**Now explore properly**, because this is the part that pays off:

- **Scrub the timeline.** Every action is a frame.
- **Click any step** — see the DOM *at that moment*, not at the end.
- **Open the Network tab** — every request the app made.
- **Check the Console tab** — errors your app logged.
- **Use the locator picker** — hover the recorded DOM and it shows you the selector that would match.

Find the exact moment it went wrong. **Without adding a single log line.**

---

## The nuances

> ### ⚠️ `if: always()` — the mistake everyone makes exactly once
>
> By default, **when a step fails the job stops.** So if your test step fails, the upload step **never runs**, and you get no trace — precisely in the case you needed one.
>
> This is maddening the first time: the test failed, you go to download the evidence, and there is none.
>
> `if: always()` tells the step to run regardless. There is a family of these worth knowing: `always()`, `success()` (the default), `failure()`, `cancelled()`.

**Artifacts are also how jobs talk to each other.** Two jobs don't share a filesystem ([CP-00](CP-00-first-workflow.md)). If job A builds something job B needs, A uploads and B downloads. That's the same mechanism, used for a different purpose — and it's how sharding works in [CP-14](CP-14-sharding-and-speed.md).

**⚠️ The free tier gives 2,000 minutes but only 500 MB of artifact storage**, and traces plus videos fill that far faster than you'll burn minutes. **Storage is the quota that actually bites.** Set `retention-days` deliberately — 7 is generous for debugging, and 90 (the default) is how you fill 500 MB without noticing.

**Video versus trace.** Video shows you *what it looked like*. A trace shows you the DOM, the network and the console *at every step*. **Video is nearly useless for debugging by comparison** — it tells you something went wrong, not why. Enable video only when the visual matters.

---

## ⚠️ You will hit this

**No artifact on the failed run.** `if: always()`. It will happen once.

**The trace is enormous.** Turn off `trace: 'on'` if you set it. Use `on-first-retry`.

**Your video-upload test needs a fixture.** Commit a tiny file — a few hundred KB, not your real test speech. Large files in git are permanent.

**The CI failure won't reproduce locally.** That's the point of the exercise. Read the trace rather than trying to reproduce it — reproducing environment-specific failures locally is often impossible and always slow.

---

## Done when

- [ ] You debugged a **CI-only** failure purely from a downloaded trace
- [ ] **No `console.log` was added** at any point
- [ ] You hit the `if: always()` problem and fixed it
- [ ] `retention-days` is set deliberately

Understanding:

- [ ] Why does the upload step need `if: always()` when it's already in the workflow?
- [ ] Why `on-first-retry` rather than `on`?
- [ ] Job A builds a file, job B needs it. How?
- [ ] Which free-tier limit will you hit first, and why isn't it minutes?

---

**Next:** [Step 04 — Every video plays](STEP-04-every-video-plays.md), then [CP-04](CP-04-services-and-caching.md).
