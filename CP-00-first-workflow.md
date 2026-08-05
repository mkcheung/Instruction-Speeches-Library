# CP-00 — Your first workflow

> **Optional.** [Step 01](STEP-01-identity.md) does not depend on this. But every later checkpoint does, and it takes two hours.

**Track:** CI · **Time:** ~2h · **After:** [Step 00](STEP-00-foundation.md) · **Then:** [Step 01](STEP-01-identity.md)

---

## 🎯 What you are learning here

By the end you should be able to answer these **without looking anything up**:

1. What the words *workflow*, *event*, *job*, *runner*, *step* and *action* each mean.
2. **Why the runner starts completely empty**, and what follows from that.
3. Why CI runs on a *fresh* machine every single time rather than a persistent one.
4. Why jobs run in parallel but steps run in sequence — and what that means for sharing files.
5. Why you pin action versions instead of floating.
6. Why `npm ci` and not `npm install`.
7. How to read a failed run and find the actual error.

**You are not learning YAML.** YAML is a syntax you'll absorb by osmosis. The concepts above are the transferable part — they're the same on GitLab CI, CircleCI and Jenkins, with different keywords.

---

## Why CI exists at all

Before you learn *how*, it's worth knowing what problem this was invented to solve — because every design choice follows from it.

**The problem: "works on my machine."**

Your laptop has accumulated years of state. Environment variables you set once. A PHP extension you installed for a different project. A dependency version that's newer than your lockfile. When your code works, you genuinely don't know whether it works *because it's correct* or *because your laptop happens to be configured a particular way.*

That gap has a cost, and the cost is delayed. Code that works for you fails for someone else — or fails in production — and by then you've forgotten the context and have to reconstruct it.

**CI's answer:** run the code on a machine that has *nothing*, every time, and make the result a fact about the code rather than a fact about a laptop.

Three properties fall out of that, and they explain most of what looks arbitrary:

| Property | Why |
|---|---|
| **The machine is fresh every run** | Accumulated state is exactly the thing being eliminated. A persistent machine would slowly become someone's laptop. |
| **Every dependency is declared** | If a step needs PHP, a step must *install* PHP. This forces your setup to be written down, which is why "CI setup" doubles as documentation. |
| **It runs automatically** | Anything requiring you to remember will eventually not happen, on the day it mattered most. |

**And the second problem: feedback delay.** A bug found two minutes after you wrote it costs almost nothing — you still have the whole thing in your head. The same bug found two weeks later costs an hour of rediscovering what you were doing. CI is mostly a machine for shortening that gap.

---

## The concept, in plain words

A **workflow** is a YAML file in your repo. When something happens — you push, you open a PR — GitHub reads it, rents you a fresh Linux machine, runs your commands, and destroys the machine.

That's genuinely all. The rest is vocabulary:

| Word | Means | Why it exists |
|---|---|---|
| **Workflow** | One YAML file in `.github/workflows/` | A unit you can enable, disable and read on its own |
| **Event** | What triggers it (`push`, `pull_request`) | Different situations warrant different work |
| **Job** | Steps on one machine. **Parallel by default.** | Independent work shouldn't queue behind unrelated work |
| **Runner** | The machine | Rented per run — that's the freshness guarantee |
| **Step** | One thing: a command, or an action | The unit that succeeds or fails, so you can see *where* |
| **Action** | A reusable step someone published | Nobody should reimplement "check out a git repo" |

> **The mental model that makes it click:** the runner starts as a **completely empty computer**. It does not have your code. It does not have PHP. It has never heard of your project.
>
> Almost all beginner confusion is a violation of this. *"Why can't it find my files?"* — because nothing put them there.

---

## Setup — in order, with the reason for each

### 1. The smallest thing that runs

`.github/workflows/ci.yml`:

```yaml
name: CI

on: [push]

jobs:
  hello:
    runs-on: ubuntu-latest
    steps:
      - run: echo "It ran."
```

Commit. Push. Open the **Actions** tab.

**Why start with something useless:** you're isolating one variable. If this doesn't run, the problem is the file's location or its syntax — nothing else. Starting with a real workflow means debugging five things at once.

### 2. Prove the runner is empty

```yaml
      - run: ls -la
      - run: which php || echo "no php here"
```

Push. Read the log. **The directory is empty and there's no PHP.**

**Why this matters more than it looks:** you now have direct evidence for the mental model, rather than my word for it. Every "why isn't this working" later resolves back to this.

### 3. Now put things on the machine

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      # WHY: the runner has no code. Nothing works before this line.
      - uses: actions/checkout@v7

      # WHY: no PHP either. Pin the exact version you run in Docker —
      # matching prod is the point; "latest" reintroduces the drift CI removes.
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.4'
          coverage: none          # coverage is slow; turn it on when you use it

      # WHY: setup-node has npm caching built in. One line, large saving.
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: web/package-lock.json

      - name: Install PHP dependencies
        working-directory: api
        run: composer install --no-interaction --prefer-dist
        # WHY --no-interaction: no human to answer prompts. It would hang forever.

      - name: Install JS dependencies
        working-directory: web
        run: npm ci
        # WHY `ci` not `install`: see below. This one matters.

      - name: Lint PHP
        working-directory: api
        run: ./vendor/bin/pint --test    # --test = check, don't rewrite

      - name: Typecheck
        working-directory: web
        run: npx tsc --noEmit

      - name: Lint JS
        working-directory: web
        run: npx eslint .
```

**Why lint in CI when you already lint locally:** because you will forget, and CI never does. The value isn't catching *your* mistakes on a good day — it's that the standard becomes automatic rather than a matter of discipline.

### 4. Break it on purpose

Introduce a type error. Push. **Watch it go red.** Click into the failed step and read the log.

Then fix it, and watch it go green.

**Why deliberately break it:** an untested safety net is not a safety net. You need to know it catches things, and you need to have read a failure log once while you *knew* what the failure was — so the next one, when you don't, is legible.

---

## Why the choices above are the choices

**Why `on: push` filtered to `main`, plus `pull_request`.** Unfiltered `push` runs on every branch, which is noisy and burns minutes. Filtering means work-in-progress branches stay quiet, and CI runs when you actually propose a change.

**Why `npm ci` instead of `npm install`.** `ci` installs exactly the lockfile and **fails** if `package.json` and the lock disagree. `install` will quietly *update* the lock. So with `install`, CI can pass against dependency versions that exist nowhere else — the precise category of problem CI is meant to eliminate. `ci` also deletes `node_modules` first, which is the freshness guarantee applied to dependencies.

**Why pin action versions.** Two reasons, and the second is the serious one:
- **Reproducibility** — a floating version means today's green and tomorrow's red with no commit between them.
- **Supply chain** — an action is *someone else's code running with access to your repo*. `@v7` follows a major tag that the maintainer can move. For high-security work you'd pin the commit SHA. For a personal project the major tag is a reasonable trade, but **know that you're making a trade.**

**Why jobs are parallel and steps are serial.** Steps build on each other — you can't install dependencies before checkout. Jobs are meant to be independent, so they run at once for speed. **The consequence people trip on: two jobs do not share a filesystem.** If job B needs a file from job A, you pass it as an artifact ([CP-03](CP-03-debugging-failures.md)).

---

## The nuances — what the docs won't tell you

**Each step runs in a fresh shell.** `cd api` in one step does not carry to the next. That's what `working-directory:` is for.

**Check that your action majors are current.** As of 2026-08-05: `checkout@v7`, `setup-node@v7`, `cache@v6`, `upload-artifact@v7`, `download-artifact@v8`. `setup-php@v2` is genuinely current — that's the maintainer's documented major tag, not a stale pin.

> ⚠️ **This one bites soon.** Node 20 is being removed from GitHub runners around **2026-09-16**. Any action still declaring `node20` stops working — **including `actions/upload-artifact@v4`**, which you'll want in CP-03. Playwright's own CI documentation currently pins `@v4`.
>
> **The habit to form now:** when you copy a workflow from any documentation, check each action's own releases page. Sample workflows are illustrations, not version oracles. This is a small thing that separates people who *use* CI from people who *maintain* it.

**`setup-node` has npm caching built in; `setup-php` has no Composer equivalent.** You'll need `actions/cache` for Composer — that's [CP-04](CP-04-services-and-caching.md).

**Free tier: 2,000 minutes/month private, unlimited public.** Not a constraint yet. The one that bites first is artifact *storage* (500 MB), which arrives in CP-03.

---

## ⚠️ You will hit this

**YAML indentation.** Whitespace-sensitive, unhelpful errors. Install a YAML linter in your editor before the second workflow, not after.

**"My workflow didn't run."** Almost always one of:
1. Not in `.github/workflows/` exactly.
2. It's on a branch, and your `on:` only fires for `main`.
3. YAML syntax error — GitHub reports these under a broken-workflow warning that's easy to miss.

**"But it works locally."** It won't, first time. **That gap is the value** — CI is telling you your project has setup requirements nobody wrote down. Each one you fix is documentation you now have.

---

## Done when

Mechanics:

- [ ] A green check next to your commit
- [ ] You broke it deliberately and watched it go red
- [ ] You read a failure log and found the actual error line

Understanding — **answer these out loud**:

- [ ] Why does a workflow need `actions/checkout` when the code is obviously in the repo?
- [ ] Why a fresh machine every run instead of one that stays warm?
- [ ] What breaks if you use `npm install` instead of `npm ci`?
- [ ] Job A writes a file. Can job B read it? Why not?
- [ ] What's the risk in `uses: some-person/some-action@main`?

If any of those is fuzzy, that's the bit to go back to — not the YAML.

---

## Going deeper (optional)

**`gh` CLI** — stop context-switching to the browser:

```bash
gh run watch                 # live-follow the current run
gh run view --log-failed     # jump straight to what broke
```

**A status badge in your README.** Cosmetic, and also what makes CI feel real:

```markdown
![CI](https://github.com/USER/REPO/actions/workflows/ci.yml/badge.svg)
```

**Worth reading once:** GitHub's page on workflow syntax. Not to memorize — to see the shape of what's available, so you know what to search for later.

---

**Next:** [Step 01 — Account and identity](STEP-01-identity.md), then [CP-01](CP-01-codegen-then-refactor.md) — the most important checkpoint in this track.
