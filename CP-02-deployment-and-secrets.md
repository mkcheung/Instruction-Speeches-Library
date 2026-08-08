# CP-02 — Real deployment, secrets and environments

> **Optional.** [Step 03](STEP-03-upload-and-watch.md) does not depend on this.

**Track:** CD · **Time:** ~4h · **After:** [Step 02](STEP-02-first-deploy.md) · **Then:** [Step 03](STEP-03-upload-and-watch.md)

> ### ⚠️ No live host yet — deploy to a local container instead
>
> You decided (2026-08-05) to run locally for now. **This checkpoint still works**, because the *mechanics* of CD have nothing to do with where the target lives.
>
> **Target a container over SSH.** That container is built and explained in a separate repo, one directory over: [`../speechcoach-deploy-target`](../speechcoach-deploy-target/FAUX-SERVER-AND-CICD-EXPLAINED.md). Start there — it introduces CI/CD from first principles before any of the mechanics below.
>
> **Why a separate repo:** this one is **public**, and the deploy private key must never land in it. Splitting the *machine you deploy to* from the *code you deploy* removes that risk structurally instead of relying on a `.gitignore`.
>
> **What that teaches identically:** secrets, `needs:`, `concurrency`, SSH host-key verification, running migrations as a separate step, rollback, and `paths-ignore`. Every skill transfers.
>
> **What it can't teach:** a real provider's quirks, DNS, TLS from a public CA, and genuine email deliverability. Those arrive at [Step 14](STEP-14-deploy-hardening.md) — and they fail *loudly*, which is why deferring them is the safe half.
>
> ⚠️ **One caveat on GitHub-hosted runners:** they cannot reach your laptop. So use a **self-hosted runner** — but read [Decision 0 in the build plan](CP-02-BUILD-PLAN.md) first, because a self-hosted runner on a *public* repo has a real attack path. (`gh` is **not** installed here and is not required; the web UI is enough. `act` is an alternative but nothing would be push-triggered, which defeats the point.)

---

## 🎯 What you are learning here

1. **The difference between CI and CD**, and why the D is the harder half.
2. How secrets work — where they live, how they're redacted, and **what that redaction does not protect you from.**
3. What an **environment** is, and why it's more than a label.
4. Why deploys need `needs:` and `concurrency:`, and what breaks without each.
5. **What is and isn't available on your account tier** — this one is a real constraint, not trivia.

---

## 🧒 The whole thing, explained simply

Read this once before the mechanics. Every idea below has a technical name later
in the document; the point here is to have the *shape* of it in your head first.

### CI and CD

You write stories. There's a library across town where people read them.

**CI (Continuous Integration) is the proofreader.** Every time you finish a
story, someone checks it automatically before anyone else sees it.

**CD (Continuous Deployment) is the courier** who walks it to the library — the
same way, every time, without you — **but only if the proofreader approved it.**

That "only if" is the whole idea, and it has a name: `needs:`. Remove it and
you've built a machine that reliably delivers broken stories.

### Why the courier is harder than the proofreader

Proofreading has no consequences. Do it a hundred times, nothing changes.
Delivering *replaces what people are currently reading*. So three rules follow:

**One courier at a time.** Two couriers on the same path bump into each other —
pages get mixed up, and if both try to rearrange the shelves you get a mess
nobody can untangle. That's `concurrency:`.

**Never interrupt a courier mid-walk.** Cancelling a proofreader is free; the
result was going to be replaced anyway. Cancelling a *delivery* halfway leaves
half a book on the shelf. That's why `cancel-in-progress` is `true` for tests
and `false` for deploys.

**The courier carries the library keys.** That's the scary part, and it's why
secrets are a whole subsystem rather than just variables.

### The shelf swap — the single most important idea

You never edit the book that's on the shelf.

You put the new copy on a **different** shelf, check it's complete, and then
move one bookmark that says *"this one"*. Moving a bookmark is instant, so no
reader ever gets half a book. If anything goes wrong before you move it, the old
book is still there and **nobody noticed**.

Every deploy is: new shelf → check → move bookmark. The bookmark is a symlink
called `current`, and moving it is one command. That single line is the only
thing in the entire process that changes what people see.

This is also why a half-succeeded deploy is impossible — not because the script
handles errors cleverly, but because of the **order** things happen in.

### Secrets — keys live at the library, not inside the book

The library's keys aren't printed inside every copy of your story. They're kept
*at the library*, in a drawer.

So you can publish your story to the entire world — which is exactly what a
public GitHub repo is — and the keys are still safe. On the server that drawer
is a file called `shared/.env`, put there **by hand, once**. No deploy ever
carries it. That's why "where secrets do *not* live" matters as much as where
they do.

**Redaction is a safety net, not a lock.** GitHub blanks out anything that looks
exactly like your secret. It doesn't *understand* your code — change the shape
of the secret even slightly and the net has a hole in it.

### Host keys — how you know you're talking to the right library

Someone could stand in the road, pretend to be the library, take your delivery,
and keep it. A **man-in-the-middle**.

The defence is that you wrote down what the library's front door looks like the
first time, and you check it every visit. That's the host key. The common
"fix" for a host-key error is to switch the checking off — which isn't a fix,
it's giving up on the only thing that catches the attack.

### Rolling back — why "the other one" isn't good enough

If the new story is bad, put yesterday's back. Easy: move the bookmark.

But "the shelf that isn't the current one" is **not** the same as "the one from
before". Do that twice and you bounce between two books forever — back to
yesterday, then *forward* into the bad one again.

So you keep a **list** of what you put out, in order, and rolling back crosses
one off the end. Three rollbacks with three releases walks you back three steps
and then *stops and says so*, rather than guessing.

### Migrations — the one thing you can't undo

Code goes back easily. **Database changes usually don't.** If a change deleted a
column, going "back" can't invent the data again.

So migrations are **forward-only**, and they're a separate, ordered step rather
than something bundled into the deploy. When a change really can't be undone,
you split it into safe halves: add the new thing → deploy → move the data →
deploy → remove the old thing. That pattern is called **expand/contract**.

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
    branches: [master]   # ⚠️ THIS repo's default branch is master, not main.
                         # Getting this wrong fails by doing NOTHING — no error
                         # anywhere, just a deploy that never happens.
    paths-ignore:
      - '**.md'          # WHY: docs changes shouldn't touch production

concurrency:
  group: deploy-production
  cancel-in-progress: false    # WHY: see the nuance below — do NOT cancel deploys
  queue: max                   # WHY: the DEFAULT (`single`) CANCELS the pending
                               # run when a newer one queues. Three rapid pushes
                               # would deploy twice and skip the middle commit.

jobs:
  ci:                          # ⚠️ NOT "test": ci.yml's own job is already
    uses: ./.github/workflows/ci.yml   # named `test`, so this would render as
                                       # the confusing "test / test"

  deploy:
    needs: ci                            # WHY: no green, no deploy
    runs-on: [self-hosted, macOS, ARM64] # a cloud runner cannot reach your laptop
    environment: production              # WHY: see step 3
    steps:
      - uses: actions/checkout@v7

      - name: Deploy
        env:
          DEPLOY_HOST:     ${{ vars.DEPLOY_HOST }}   # a VARIABLE, not a secret —
          DEPLOY_KEY:      ${{ secrets.DEPLOY_KEY }} # as a secret, GitHub would
          DEPLOY_HOST_KEY: ${{ secrets.DEPLOY_HOST_KEY }}  # redact "127.0.0.1"
        run: ./scripts/deploy.sh                     # from every log in every job
```

> ⚠️ `queue: max` together with `cancel-in-progress: true` is a **validation
> error** that no linter catches — it passes the schema and GitHub rejects it
> server-side. Keep `cancel-in-progress: false`.

### 2. Add secrets, then watch redaction work

Settings → Secrets and variables → Actions.

Now add a step that echoes one:

```yaml
      - run: echo "The key is ${{ secrets.DEPLOY_KEY }}"
```

⚠️ **Put this in the `deploy` job, not in `ci.yml`.** `DEPLOY_KEY` is an
*environment* secret, and only the job that declares `environment: production`
can see it. Anywhere else it resolves to the **empty string** — you get a blank
line, no `***`, and conclude either that redaction is broken or that it passed.

**The log shows `***`.** GitHub redacts known secret values automatically, one
`***` per line: the runner registers the whole value *and* each individual line,
which is what makes a multi-line SSH key work.

**Then delete that step**, because the lesson has a second half — see the
nuances. (GitHub's own guidance if a secret ever does reach a log: delete the
log **and rotate the secret**. Treat it as burned.)

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

**⚠️ Redaction is pattern-matching, not comprehension.** GitHub replaces exact matches of known secret values. It does **not** understand your code. Redaction is a safety net for accidents, not a security control. The real control is never printing secrets at all.

But be precise about *what* gets through, because the obvious guesses are wrong. The runner registers the whole secret **and each individual line**, plus about a dozen encodings — including **base64 (with shift variants), JSON, URI-escaping and command-line escaping**. So `base64`, `toJSON(secrets)` and even `set -x` are all masked.

What actually leaks is anything that changes the *bytes* into a form nobody registered:

- **Re-wrapping the line breaks.** The registered values are the original ~70-character lines. `ssh-keygen -p -m PEM`, `fold -w 40`, or any tool that re-emits the key with different wrapping produces lines matching nothing. **This is the realistic one for an SSH key** — i.e. for this checkpoint's secret.
- **Hex** — `xxd -p`, `od`, `openssl … -hex`. There is no hex encoder in the list.
- **Compression**, or a value *derived* from the secret (a JWT, a signature). GitHub: *"if a secret is used to generate another sensitive value … be sure to register that JWT as a secret or else it won't be redacted."*
- **Partial prints** — `cut -c1-40`.

GitHub's own summary: *"Because there are multiple ways a secret value can be transformed, automatic redaction is not guaranteed."*

**Secrets aren't available to workflows triggered by PRs from forks.** Deliberate — otherwise anyone could open a PR that prints your production key. Not an issue for a solo repo, but it explains why some workflows look oddly split.

> ### ⚠️ Manual approval gates are public-repo-only below Enterprise
>
> **Verified 2026-08-05.** Required reviewers and wait timers are available on **public repositories** on Free, Pro and Team — and **not on private repositories** unless you're on Enterprise. **Pro does not unlock this.**
>
> **What this means for you:** if you want to practise approval gates, **the repo has to be public.** Given you're building this as a portfolio piece that's probably fine — but decide it on purpose rather than discovering it here.
>
> ⚠️ **Correction — environments do NOT "work either way" on Free.** Verified against current docs: *"If you are using GitHub Free, environment secrets are only available in public repositories."* And on Free + private you cannot create an environment **at all** — *"you will not be able to configure any environments."* Deployment-branch restrictions are likewise public-only on Free. So on Free the choice is starker than "you lose the protection rules": going private costs you environment secrets, branch restrictions **and** approval gates. Only Pro/Team/Enterprise get environments on private repos.

**`paths-ignore` is a real time-saver and a small trap.** It stops docs commits deploying.

⚠️ **Correction:** it does **not** mean "a commit touching only workflow files won't deploy". The rule is *"if any path names do not match patterns in `paths-ignore`, … the workflow will run"* — and `.github/workflows/deploy.yml` doesn't match `'**.md'`, so a workflow-only commit **does** deploy. Note also that `'**.md'` matches at any depth (`docs/foo.md`, not just `foo.md`); `'*.md'` would be root-only.

⚠️ **And `paths-ignore` does nothing on a called workflow.** GitHub doesn't evaluate path filters for `workflow_call` at all — a reusable workflow's own filters are ignored entirely when it's invoked via `uses:`. Only the caller's filter gates the run.

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
