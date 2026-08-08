# CP-02 build plan — CD against a local deploy target

**Implements:** [CP-02](CP-02-deployment-and-secrets.md) · **After:** [Step 02](STEP-02-first-deploy.md) (done) · **Optional:** [Step 03](STEP-03-upload-and-watch.md) does not depend on this

> ### ✅ What you can do when this is finished
>
> Merge a PR to `master`. Tests run on GitHub's cloud runners. Only if they pass, a deploy job SSHes into a container standing in for a VPS, uploads a new release, runs migrations as a separate ordered step, and atomically swaps a `current` symlink — with a one-command rollback. Point it at a dead host and it fails without touching what's live.

---

## ⚠️ Read this first: the server lives in a different repo

The machine you deploy **to** is not part of the code you deploy. It has its own
repository, one directory over:

```
SideProjects/
  Instruction-Speeches-Library/     <- this repo: the app, the deploy scripts, the workflow
  speechcoach-deploy-target/        <- the faux VPS: Dockerfile, sshd, provisioning
```

**Build the server first.** Follow
[`../speechcoach-deploy-target/FAUX-SERVER-AND-CICD-EXPLAINED.md`](../speechcoach-deploy-target/FAUX-SERVER-AND-CICD-EXPLAINED.md) —
it explains what CI/CD is from first principles and walks the setup end to end.
Come back here when `ssh -p 2222 deploy@127.0.0.1 whoami` prints `deploy`.

**Why split them.** Three reasons, in order of how much they matter:

1. **The deploy private key can never reach a public repo.** This repo is
   public. That is the risk CP-02 spends most of its length worrying about, and
   the split removes it structurally rather than by remembering a `.gitignore`.
2. It is honest about the boundary. A rented VPS is not a file in your app.
3. You can delete and rebuild the server without touching the app's history.

**What it costs.** The server can't use `FROM runtime` the way a stage inside
this repo's Dockerfile could — it starts from the already-built
`instruction-speeches-library-app:latest` instead. So `docker compose build app`
here is a prerequisite there, and the app stack must be up first because the
server joins `speechcoach-dev` as an external network.

---

## What's already been proven, so you don't have to wonder

Everything below was executed against the real stack, not reasoned about. The
failure modes listed are ones that were *observed*, and several are traps that
the obvious implementation walks straight into.

| Claim | Status |
|---|---|
| Red runs fail without touching what's live | 255/~10 s dead host; 255/instant bad host key; 1 on missing `.env` — `current` unchanged in all three |
| A green deploy runs all 11 migrations | ✅ |
| The release's own code is what loads | ✅ `User.php` resolves under `/srv/speechcoach/releases/…`, not `/var/www/html` |
| Rollback walks backwards and then refuses | ✅ C → B → A → `no usable earlier release` |
| No secret appears in any log | ✅ |

---

## ⚠️ Decision 0 — settle this before the GitHub half

**This repo is public.** That collides with the self-hosted runner CP-02 recommends.

> **Verbatim from GitHub's secure-use documentation:** *"Self-hosted runners should almost never be used for public repositories on GitHub, because any user can open pull requests against the repository and compromise the environment."*

**The attack path, traced — because it is not the one you'd guess.** You will
reasonably think: *the deploy job only runs on push to `master`, and a stranger
can't push to `master`, so they can't reach my machine.* That's wrong. A fork PR
runs **`ci.yml`**, and a fork PR can *edit `ci.yml` itself* — adding
`runs-on: [self-hosted, …]` to it. The `pull_request` trigger then runs **the
PR's version** of that file on your laptop. Fork PRs get no secrets, but
arbitrary code execution as your macOS user is already the whole problem: your
SSH keys, browser profiles, source trees, LAN, and this project's own
Postgres/SeaweedFS/Mailpit. And unlike a cloud runner, **a compromise persists**.

**▸ Do: check your plan tier** at [github.com/settings/billing](https://github.com/settings/billing) → "Current plan".

| | Stay public | Go private |
|---|---|---|
| Environment secrets | ✅ any tier | ❌ on Free (needs Pro) |
| Deployment-branch restrictions | ✅ any tier | ❌ on Free (needs Pro) |
| Approval gates (required reviewers) | ✅ Free/Pro/Team | ❌ needs Enterprise |
| Self-hosted runner safety | ⚠️ the attack above | ✅ safe |

> **Verified:** *"If you are using GitHub Free, environment secrets are only available in public repositories."* On Free + private you cannot create an environment **at all** — *"you will not be able to configure any environments."* So CP-02's "environments work either way" is **wrong on Free**.

### The options

- **A — Stay public, runner on the host, supervised. ← recommended for this checkpoint.**
  `./run.sh` in a terminal you watch, `never svc.sh install`, deregister when done.
  Simplest thing that works, and the labels below match it.
- **B — Go private.** Runner is safe; on Free you lose most of CP-02 §3 and fall
  back to repo-level secrets, skipping the "environments are more than a label"
  lesson entirely.
- **C — Stay public, runner in a container.** Narrower blast radius than A, but
  ⚠️ **it is not GitHub's guidance** (that's *ephemeral / just-in-time* runners —
  GitHub explicitly cautions that destroy-after-each-job "might not be as
  effective as intended"). And the blast radius is not just "a container": a
  runner on `speechcoach-dev` reaches your Postgres (Step 01 identity data),
  SeaweedFS (the Step 00 spike video), Mailpit, and the host via
  `host.docker.internal`.
  **If you pick this, four things change** and none are optional:
  `DEPLOY_HOST` → `deploy-target`; `DEPLOY_PORT` → `22`; `runs-on` →
  `[self-hosted, Linux, ARM64]`; and the runner image ships **neither `ssh` nor
  `rsync`**, so you must install both.
- **D — `act`.** Nothing untrusted executes, but nothing is push-triggered
  either, so the acceptance criterion *"reaches the target with no human
  involvement"* becomes unachievable.

> ⚠️ **"0 forks, nobody's watching" is not a mitigation.** Public repos are
> enumerable in near-real-time and fork count is a lagging indicator, not an
> access control. What makes A survivable is the *short window*, not obscurity.

**▸ Do (either way): Settings → Actions → General → Fork pull request workflows → Require approval for all external contributors.**
The public-repo default is "first-time contributors", which one merged typo-fix
PR defeats.

> ⚠️ **This buys you a decision point, not a wall.** GitHub: malicious code runs
> "if the user is allowed to bypass approval … **or if the pull request is
> approved**". Clicking "Approve and run" to see whether a stranger's PR passes
> CI *is* executing their code on your machine. Never approve a fork PR while
> the runner is registered.

**▸ Do when finished:** deregister — `./config.sh remove --token <token>` and
delete the runner under Settings → Actions → Runners.

---

## Phase 1 — Make `ci.yml` callable *(2 min)*

**▸ Do:** add one line to `.github/workflows/ci.yml`:

```yaml
on:
  push:
  pull_request:
  workflow_call:      # WHY: required before `uses:` can call this file.
                      # A "reusable workflow" is a whole workflow file invoked
                      # as a JOB — different from an Action, which is a single
                      # STEP. Same `uses:` keyword, two different levels:
                      #   steps: - uses: actions/checkout@v7   <- an Action
                      #   jobs:  ci: {uses: ./…/ci.yml}        <- this
```

> **Verified:** adding `workflow_call:` has **no side effects** on the existing
> `push`/`pull_request` behaviour — triggers are independent. A bare
> `workflow_call:` with no `inputs:`/`secrets:` is schema-valid, and `ci.yml`
> needs neither. The called workflow keeps its own `runs-on: ubuntu-latest`.

> ⚠️ **Do NOT add `branches-ignore: [master]` yet.** Until `deploy.yml` exists,
> that line leaves `master` with **zero CI**.

> ⚠️ GitHub does **not** evaluate `paths`/`paths-ignore` for `workflow_call` at
> all — a called workflow's own filters are ignored entirely when invoked via
> `uses:`. The caller's filter gates the whole run.

**✅ Done when:** the Actions tab still shows a normal run on your branch.

---

## Phase 2 — The server *(see the other repo)*

**▸ Do:** work through
[`../speechcoach-deploy-target/FAUX-SERVER-AND-CICD-EXPLAINED.md`](../speechcoach-deploy-target/FAUX-SERVER-AND-CICD-EXPLAINED.md).

**✅ Done when:**
```bash
docker compose exec deploy-target sshd -T | grep -E 'permitrootlogin|passwordauthentication|allowusers'
ssh -i docker/sshd/deploy_key -p 2222 deploy@127.0.0.1 whoami   # -> deploy
```
The first must show *your* values (`no`, `no`, `deploy`), not the stock ones.

---

## Phase 3 — The deploy scripts *(already written — read them)*

`scripts/_ssh.sh`, `scripts/deploy.sh`, `scripts/rollback.sh` are in this repo
and working. Read them; the comments explain the traps rather than just the
mechanics. The five worth knowing before you change anything:

**1. `vendor` is copied, never symlinked.** PHP resolves symlinks for `__DIR__`,
so pointing `vendor/` at the image's tree makes the generated autoloader compute
its base directory from the *link target*. Every `App\…` class then loads from
the image, not the release you just uploaded. **The deploy goes green and none
of your code is running.** Measured cost of copying instead: ~0.2 s and 120 MB
per release, ~880 MB at `KEEP_RELEASES=5`.

**2. `umask 002` is load-bearing, not hygiene.** `artisan` writes
`storage/logs/laravel.log` as `deploy`. With the default umask that file lands
`0644`, php-fpm (www-data) cannot append to it, and every request that logs
anything 500s. A shared group and the setgid bit give group *ownership* — they
never give group *write* on a newly created file.

**3. `bootstrap/cache` needs group write.** rsync lands the release
`deploy:deploy 0755`. Laravel regenerates `packages.php`/`services.php` there
whenever they go stale, as www-data. Without the `chmod`, the first request
after any cache clear is a hard 500 — and it *looks* fine until then, because
the migrate step happens to write those files first.

**4. Rollback pops a stack, it does not guess.** "The newest release that isn't
the current one" is not "the one before this one". A failed deploy leaves a
directory with a *newer* timestamp, so the naive rule promotes the broken
release every time. And rolling back twice **oscillates**. A one-slot `previous`
file does not fix this — it just moves the oscillation. Hence `history`.

**5. `mv -T` is mandatory.** Without it, busybox `mv` descends *into* the
directory the symlink points at, `current` never changes, and you get a stray
`current.tmp` inside the old release.

**▸ Do: prove it RED before you ever prove it green.**
```bash
export DEPLOY_HOST=127.0.0.1
export DEPLOY_KEY="$(cat ../speechcoach-deploy-target/docker/sshd/deploy_key)"
export DEPLOY_HOST_KEY="$(ssh-keyscan -p 2222 -t ed25519 127.0.0.1 | cut -d' ' -f2-)"

DEPLOY_HOST=203.0.113.99 ./scripts/deploy.sh   # expect 255 in ~10s, nothing written
./scripts/deploy.sh                            # expect GREEN
```

**Why a half-succeeded deploy is impossible** — it's the *ordering*, not error
handling. Uploads go to a new directory nothing is serving; the only statement
that changes what's live is one atomic `mv -T`; `set -e` guarantees a failure
before it never reaches it.

> ⚠️ **Never add `set -x` "just to debug"** — verified that it *would* leak the
> key, and that without it no key material appears in any log.

---

## Phase 4 — The runner *(40 min)*

**▸ Settle Decision 0 first.**

Repo → **Settings → Actions → Runners → New self-hosted runner** → **macOS /
ARM64**. Use the version and token the UI shows you. `gh` is not required.

**▸ Do: install it OUTSIDE the repo** — `~/actions-runner`, never inside the
working tree, or you get thousands of untracked files plus `_work/` containing a
nested checkout of the repo inside itself.

Auto-assigned labels: `self-hosted`, `macOS`, `ARM64` → hence
`runs-on: [self-hosted, macOS, ARM64]`.

> Labels are **case-insensitive**, and GitHub *"does not validate that the
> runner is actually using that operating system or architecture"* — so if you
> took Decision 0 option C, you can either pass `--labels macOS,ARM64` or change
> `runs-on`. Do one; do not leave both mismatched, or the job sits **Queued**
> forever with nothing red to click.

**▸ Do: keep it running.** `./run.sh` in a dedicated terminal for the rest of
the checkpoint. Docker Desktop and `deploy-target` must also be up.

> ⚠️ **What persists between runs is the *machine*, not the workspace.**
> `actions/checkout` defaults to `clean: true` (`git clean -ffdx && git reset
> --hard HEAD`), so stale branch files in the workspace *are* cleaned. What
> survives is everything outside it: `_work/_tool`, `_work/_actions`, package
> caches, `~/.ssh`, and Docker state — including the deploy target's own
> accumulated releases. That's what makes a self-hosted compromise persistent.

**✅ Done when:** Settings → Actions → Runners shows **Idle**.

---

## Phase 5 — Environment, secrets, `deploy.yml` *(40 min)*

**▸ Do: Settings → Environments → New environment → `production`.** Then:
- **Environment secrets** → `DEPLOY_KEY` (contents of
  `../speechcoach-deploy-target/docker/sshd/deploy_key`) and `DEPLOY_HOST_KEY`.
  Environment-scoped, **not** repo-level.
- **Deployment branches** → Selected branches → `master`.

> ⚠️ **Put `DEPLOY_HOST` in Variables, not Secrets** (→ `vars.DEPLOY_HOST`). As a
> secret, GitHub redacts the literal string `127.0.0.1` from **every** log line
> in every job, so unrelated output sprouts `***`.

```yaml
name: Deploy

on:
  push:
    branches: [master]          # NOT main — this repo's default branch is master
    paths-ignore:
      - '**.md'                 # matches docs/foo.md too, not just top level
  workflow_dispatch:

concurrency:
  group: deploy-production
  cancel-in-progress: false     # cancelling a deploy halfway leaves files
                                # half-copied and migrations half-run
  queue: max                    # WHY: the DEFAULT is `queue: single`, which
                                # CANCELS the pending run when a new one queues.
                                # Three rapid pushes would give you TWO deploys
                                # and silently skip the middle commit.

jobs:
  ci:                           # NOT "test" — ci.yml's own job is already named
    uses: ./.github/workflows/ci.yml   # `test`, which would render "test / test"

  deploy:
    needs: ci                   # WHY: no green, no deploy. Do NOT add
                                # `if: always()` — it defeats the entire gate.
    runs-on: [self-hosted, macOS, ARM64]
    environment: production
    steps:
      - uses: actions/checkout@v7
      - name: Deploy
        env:
          DEPLOY_HOST:     ${{ vars.DEPLOY_HOST }}
          DEPLOY_KEY:      ${{ secrets.DEPLOY_KEY }}
          DEPLOY_HOST_KEY: ${{ secrets.DEPLOY_HOST_KEY }}
        run: ./scripts/deploy.sh
```

> ⚠️ `queue: max` and `cancel-in-progress: true` together are a **validation
> error** — and no linter catches it, because it passes the schema. GitHub
> rejects it server-side. Keep `cancel-in-progress: false`.

**Optional:** add `branches-ignore: [master]` to `ci.yml`'s `push:` to stop the
duplicate run. ⚠️ Two real costs: a master push touching **only** `.md` files
then runs *nothing*, and if `deploy.yml` is ever deleted, master silently gets
**zero** CI. Eating the duplicate run is defensible.

> ⚠️ **The PR-visible check is `test`, from `ci.yml`'s own `pull_request`
> trigger.** `deploy.yml` runs only on `push: master`, so it never appears on a
> PR — requiring it in branch protection would leave every PR pending forever,
> which [CP-12](CP-12-required-checks.md) calls out.

**✅ Done when:** a merge to `master` shows **two** jobs, and the repo homepage
sidebar has a **production** entry under *Environments* with deployment history.
That history is CP-02 §3's headline — go look at it.

---

## Acceptance

- [ ] A push to **`master`** reaches the deploy target with no human involvement
- [ ] The deploy job **does not run** when tests fail — break a test on purpose, **then fix it back**
- [ ] A secret is redacted in a log — add `- run: echo "${{ secrets.DEPLOY_KEY }}"` **to the `deploy` job**, and delete the step afterwards
- [ ] A deploy failed safely against a bad host — set `vars.DEPLOY_HOST` to `203.0.113.99`, watch it go red in ~10 s with `current` unchanged, **then restore it**
- [ ] **Deliberately break it once:** wrong `DEPLOY_HOST_KEY`, watch `Host key verification failed`, understand why `StrictHostKeyChecking=no` would have "fixed" it and why that fix is worthless — **then restore the real value**

> ⚠️ **The redaction test must go in the `deploy` job.** Put it in `ci.yml` and
> `secrets.DEPLOY_KEY` resolves to the **empty string** — you get a blank line,
> no `***`, and conclude either that redaction is broken or that it passed.
> `deploy` is the only job with `environment: production`.

> ⚠️ Three of five require editing a secret/variable in the UI and **putting it
> back**. Forget the restore and your next deploy fails for a reason you already
> "fixed".

### Understanding

- [ ] Why `cancel-in-progress: true` for tests but `false` for deploys?
- [ ] GitHub redacted your secret. Name a way one could still leak.
- [ ] What does an environment give you that a plain secret doesn't?
- [ ] Can you use approval gates on this repo? What does that cost you?

> **The answer to #2 is less obvious than it looks.** The runner registers the
> whole secret **and each individual line**, plus eleven encodings including
> base64 (with shift variants) and JSON — so `base64`, `toJSON(secrets)` and
> `set -x` are all masked. What actually gets through is anything that changes
> the *bytes*: **re-wrapping the line breaks** (`ssh-keygen -p -m PEM`,
> `fold -w 40`) produces lines matching nothing registered — the realistic leak
> for an SSH key. Also hex (`xxd -p`), compression, and derived values like a
> JWT. Masking is exact-substring matching; GitHub's own words: *"this redaction
> is not guaranteed."*

---

## Build order

**Sitting 1 — nothing on GitHub is touched.**
1. Phase 1 — `workflow_call:`
2. Phase 2 — the server, in the other repo
3. Phase 3 — read the scripts; **prove red before green**

**Sitting 2 — GitHub.**
4. **Decision 0**, plus the fork-approval setting
5. Phase 4 — runner
6. Phase 5 — environment, variables, secrets, `deploy.yml`
7. Acceptance (~45 min — three push-and-wait cycles)

---

**The residual risk you're accepting:** this practises the *file-copy-to-a-VPS*
model against a container on your own laptop. Real provisioning, real DNS, a
public CA, deliverability, and the *image-promotion* model this app would
actually use in production all remain undiscovered until
[Step 14](STEP-14-deploy-hardening.md). Every one fails loudly and immediately
when wrong — which is why deferring them is the safe half.
