# Learning track — CI/CD and Playwright

**A parallel track to [STEPS.md](STEPS.md).** Sixteen checkpoints, one *between* each build step.

> **Every checkpoint is optional.** No build step depends on any of them. They are sized to fit between steps — but if you skip one, the next step still works.

Each checkpoint is its own file, and each one carries:

| Section | What it's for |
|---|---|
| **🎯 What you are learning** | Explicit objectives. The transferable concepts, not the syntax. |
| **Why this exists** | The problem the practice was invented to solve. Without this you're memorizing. |
| **Setup — in order** | Real, runnable config, **with the reason for each line.** |
| **The nuances** | What the documentation doesn't tell you. |
| **⚠️ You will hit this** | Predicted failures. **When it happens you'll already know what it is.** |
| **Done when** | Mechanics *and* questions to answer out loud. Completion ≠ understanding. |

---

## The checkpoints

| # | After step | Concept | Track | Time |
|---|---|---|---|---|
| [**CP-00**](CP-00-first-workflow.md) | [00](STEP-00-foundation.md) | Your first workflow — what CI actually is | CI | 2h |
| [**CP-01**](CP-01-codegen-then-refactor.md) | [01](STEP-01-identity.md) | **Codegen, then refactor** ⭐ | Playwright | 4h |
| [**CP-02**](CP-02-deployment-and-secrets.md) | [02](STEP-02-first-deploy.md) | Deployment, secrets, environments | CD | 4h |
| [**CP-03**](CP-03-debugging-failures.md) | [03](STEP-03-upload-and-watch.md) | Debugging a failure you cannot see | Both | 3h |
| [**CP-04**](CP-04-services-and-caching.md) | [04](STEP-04-every-video-plays.md) | Service containers, caching, the codec trap | CI | 4h |
| [**CP-05**](CP-05-two-users-one-test.md) | [05](STEP-05-invitation-loop.md) | Two users in one test | Playwright | 4h |
| [**CP-06**](CP-06-testing-time-based-ui.md) | [06](STEP-06-watch-commentary.md) | Testing time-based UI | Playwright | 4h |
| [**CP-07**](CP-07-flakiness.md) | [07](STEP-07-write-commentary.md) | Flakiness, and why `sleep()` is a lie | Playwright | 3h |
| [**CP-08**](CP-08-testing-rich-text.md) | [08](STEP-08-essay.md) | Testing a rich-text editor | Playwright | 3h |
| [**CP-09**](CP-09-matrix-builds.md) | [09](STEP-09-captions.md) | Matrix builds | CI | 2h |
| [**CP-10**](CP-10-faking-devices.md) | [10](STEP-10-voice-annotation.md) | Faking a microphone | Playwright | 3h |
| [**CP-11**](CP-11-isolation-and-parallelism.md) | [11](STEP-11-privacy-erasure.md) | Test isolation and parallelism | Playwright | 4h |
| [**CP-12**](CP-12-required-checks.md) | [12](STEP-12-admin-portal.md) | Required checks — CI that can block you | CI | 2h |
| [**CP-13**](CP-13-visual-regression.md) | [13](STEP-13-social-layer.md) | Visual regression | Playwright | 3h |
| [**CP-14**](CP-14-sharding-and-speed.md) | [14](STEP-14-deploy-hardening.md) | Sharding and wall-clock time | CI | 3h |
| [**CP-15**](CP-15-accessibility-gates.md) | [15](STEP-15-accessibility.md) | Accessibility as a gate | Playwright | 3h |

**~51 hours across nine months.** A drip, not a bootcamp.

---

## Why checkpoints rather than one testing phase

[§19](MODERNIZATION_PLAN.md) originally deferred Playwright, and the reasoning was sound **for a product**: end-to-end tests written against a moving UI become maintenance debt.

**Learning is the opposite problem.** It needs many small repetitions with fast feedback. One "add testing" phase at the end teaches you almost nothing, because you'd do each thing exactly once and never revisit it.

The product plan's instinct still applies in one place, and it's what makes this viable at all: **§19 already specifies a curated `data-testid` module and `data-visible` as a test contract.** Those hooks are why sixteen checkpoints produce one durable suite instead of sixteen brittle ones.

---

## If you're short on time

**The four that carry the most:**

1. **[CP-01](CP-01-codegen-then-refactor.md)** — selector strategy is the entire Playwright skill. Everything else assumes it.
2. **[CP-03](CP-03-debugging-failures.md)** — without traces you debug CI by pushing commits, which is unbearable.
3. **[CP-07](CP-07-flakiness.md)** — a flaky suite is worse than none, and this is where you learn why.
4. **[CP-12](CP-12-required-checks.md)** — until CI can block a merge, it's decoration.

**The most product-specific:** [CP-04](CP-04-services-and-caching.md) (the codec trap fires on your own laptop), [CP-05](CP-05-two-users-one-test.md) (proves your central security promise), [CP-06](CP-06-testing-time-based-ui.md) (the flagship feature).

---

## What this track does not teach

- **It is not the bulk of your testing.** §19's Pest feature tests and Vitest unit tests carry most coverage. E2E is the thin, expensive top layer that proves the pieces connect.
- **Deployment here is single-environment.** Blue-green, canaries and automated rollback are real topics this doesn't reach.
- **No load testing, no security scanning, no dependency-update automation.**
- ⚠️ **CI cannot test iOS Safari**, which several acceptance criteria require. Keep a manual list — [CP-10](CP-10-faking-devices.md) argues that knowing your automation's boundary is itself a skill.

---

## Verified reference — 2026-08-05

Checked against primary sources. **These go stale — re-check before relying on them.**

| Thing | Current | Note |
|---|---|---|
| `actions/checkout` | **v7** | v7 refuses fork PR code by default under `pull_request_target` |
| `actions/setup-node` | **v7** | Built-in npm cache via `cache: 'npm'` |
| `actions/cache` | **v6** | Still needed for Composer |
| `actions/upload-artifact` | **v7** | ⚠️ **v4 declares `node20` and breaks ~2026-09-16** |
| `actions/download-artifact` | **v8** | |
| `shivammathur/setup-php` | pin **`@v2`** | Current — the maintainer's documented major |
| Free tier | 2,000 min · **500 MB artifacts** | Storage bites first |

### Three corrections that changed this track

Recorded because each would have taught something false:

1. **The H.264 gotcha inverted.** Since Playwright **1.57**, `chromium` is Chrome for Testing on macOS arm64 and Linux x64 — and **has** H.264. The problem **relocated to arm64 Linux**, which means it now fires on your own machine via Docker. Better lesson, opposite fact. ([CP-04](CP-04-services-and-caching.md))
2. **Every `actions/*` major was stale**, with a hard deadline in September 2026.
3. **Manual approval gates are public-repo-only** below Enterprise — so for a solo learner on a private repo, that lesson is unavailable. On **Free**, going private also costs you environment secrets and deployment-branch restrictions; you cannot configure an environment at all. ([CP-02](CP-02-deployment-and-secrets.md), [CP-12](CP-12-required-checks.md))

### Still unverified — check before relying on these

- ⚠️ Whether `channel: 'chrome'` works **at all** on linux/arm64. **Do not present it as the arm64 fix.**
- ⚠️ Branch protection on **Free + private** repos specifically. Public repos are fine.
- H.264 on linux **x64** was inferred from the same build channel, not measured. One CI job would settle it — and makes a good CP-04 exercise.

> Everything else is described by **concept rather than exact flag**, deliberately, because commands change and this will outlive them.
