# CP-02 — Real deployment, secrets and environments

> **Optional.** [Step 03](STEP-03-upload-and-watch.md) does not depend on this.

**Track:** CD · **Time:** ~4h · **After:** [Step 02](STEP-02-first-deploy.md) · **Then:** [Step 03](STEP-03-upload-and-watch.md)

---

## 🎯 What you are learning here

1. **The difference between CI and CD**, and why the D is the harder half.
2. How secrets work — where they live, how they're redacted, and **what that redaction does not protect you from.**
3. What an **environment** is, and why it's more than a label.
4. Why deploys need `needs:` and `concurrency:`, and what breaks without each.
5. **What is and isn't available on your account tier** — this one is a real constraint, not trivia.

---

## Why CD is harder than CI

CI answers *"is this code OK?"* — a question with no consequences. Run it a hundred times; nothing changes.

CD answers *"should this replace what real people are using?"* — and getting it wrong is visible to users.

Three things follow, and they're why deployment workflows look more paranoid than test workflows:

**1. It must not run in parallel with itself.** Two deploys at once means two processes writing the same files and racing migrations. `concurrency:` exists for this.

**2. It must not run on failure.** Deploying code whose tests failed defeats the point of having tests. `needs:` exists for this.

**3. It needs credentials, and credentials are the dangerous part.** Your CI needs the power to change production, which means anyone who can run your CI has that power too. That's why secrets are their own subsystem rather than just environment variables.

---

## Setup — in order

### 1. Split test from deploy

```yaml
name: Deploy

on:
  push:
    branches: [main]
    paths-ignore:
      - '**.md'          # WHY: docs changes shouldn't touch production

concurrency:
  group: deploy-production
  cancel-in-progress: false    # WHY: see the nuance below — do NOT cancel deploys

jobs:
  test:
    uses: ./.github/workflows/ci.yml      # reuse, don't duplicate

  deploy:
    needs: test                            # WHY: no green, no deploy
    runs-on: ubuntu-latest
    environment: production                # WHY: see step 3
    steps:
      - uses: actions/checkout@v7

      - name: Deploy
        env:
          DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
          DEPLOY_KEY:  ${{ secrets.DEPLOY_KEY }}
        run: ./scripts/deploy.sh
```

### 2. Add secrets, then watch redaction work

Settings → Secrets and variables → Actions.

Now add a step that echoes one:

```yaml
      - run: echo "The key is ${{ secrets.DEPLOY_KEY }}"
```

**The log shows `***`.** GitHub redacts known secret values automatically.

**Then delete that step**, because the lesson has a second half — see the nuances.

### 3. Create an environment

Settings → Environments → New environment → `production`.

**Why environments are more than a label:**
- Secrets can be scoped to one environment, so a staging deploy physically cannot read production credentials.
- Deployments are **recorded** — you get a history of what went where, and when.
- Protection rules attach here (with a caveat below).

### 4. Fail a deploy on purpose

Point `DEPLOY_HOST` at a nonexistent server. Push. **Watch it go red without touching production.**

**Why this matters:** you need to know your deploy fails *safely*. A deploy script that half-succeeds and leaves the app broken is worse than one that refuses to start.

---

## The nuances

**⚠️ `cancel-in-progress: false` for deploys, `true` for tests.** Cancelling a test run is free — the results were going to be superseded. **Cancelling a deploy halfway through leaves your server in an unknown state**: files half-copied, migrations half-run. Queue deploys; never interrupt them.

**⚠️ Redaction is pattern-matching, not comprehension.** GitHub replaces exact matches of known secret values. It does **not** understand your code. If your script base64-encodes a secret, or prints part of it, or a dependency logs it, **that gets through**. Redaction is a safety net for accidents, not a security control. The real control is never printing secrets at all.

**Secrets aren't available to workflows triggered by PRs from forks.** Deliberate — otherwise anyone could open a PR that prints your production key. Not an issue for a solo repo, but it explains why some workflows look oddly split.

> ### ⚠️ Manual approval gates are public-repo-only below Enterprise
>
> **Verified 2026-08-05.** Required reviewers and wait timers are available on **public repositories** on Free, Pro and Team — and **not on private repositories** unless you're on Enterprise. **Pro does not unlock this.**
>
> **What this means for you:** if you want to practise approval gates, **the repo has to be public.** Given you're building this as a portfolio piece that's probably fine — but decide it on purpose rather than discovering it here.
>
> Environments themselves, and environment-scoped secrets, work either way. It's the *protection rules* that are gated.

**`paths-ignore` is a real time-saver and a small trap.** It stops docs commits deploying. It also means a commit touching *only* workflow files won't deploy — occasionally surprising.

---

## ⚠️ You will hit this

**SSH host-key verification failure on the first run.** Everyone's does. The runner has never seen your server. Add the host key explicitly — do **not** disable host-key checking, which is the tempting fix and removes the protection entirely.

**The deploy succeeds but the app is broken.** Usually migrations. Run them as a distinct, ordered step — and note §21.5's warning: **never run migrations from a container entrypoint**, because with more than one container they race.

**You'll want to test deploys by pushing repeatedly.** Use a staging environment for this, or you'll thrash production while learning.

---

## Done when

- [ ] A push to `main` reaches your live host with no human involvement
- [ ] The deploy job **does not run** when tests fail — proven by making them fail
- [ ] A secret is redacted in a log, and you deleted that step afterwards
- [ ] A deploy failed safely against a bad host

Understanding:

- [ ] Why `cancel-in-progress: true` for tests but `false` for deploys?
- [ ] GitHub redacted your secret. Name a way one could still leak.
- [ ] What does an environment give you that a plain secret doesn't?
- [ ] Can you use approval gates on this repo? Why or why not?

---

**Next:** [Step 03 — Upload and watch](STEP-03-upload-and-watch.md), then [CP-03](CP-03-debugging-failures.md).
