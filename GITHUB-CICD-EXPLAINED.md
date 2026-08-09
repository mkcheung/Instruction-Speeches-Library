# How the whole CI/CD pipeline fits together

Written 2026-08-08, after building it. Every command here was run against the
real setup. The goal is that you can rebuild this from scratch without help.

Each section does the same three things: **the idea** (plain language), **what
you actually did** (the click or the line of YAML), and **how to check it**.

---

## 1. The map

Four places. Everything below is one of these four talking to another.

```
┌─ GITHUB (the dispatch office) ────────────────────────────┐
│   • watches your repo for pushes                          │
│   • holds the recipe cards (.github/workflows/*.yml)      │
│   • holds the locked key cabinet (environment: production)│
│   • keeps the logbook (Environments panel)                │
└───────────────┬───────────────────────────────────────────┘
                │ hands out job cards + keys
                ▼
┌─ YOUR MAC (the worker) ───────────────────────────────────┐
│   ~/actions-runner  — ./run.sh, "Listening for Jobs"      │
│   checks out the repo, runs ./scripts/deploy.sh           │
└───────────────┬───────────────────────────────────────────┘
                │ ssh + rsync over 127.0.0.1:2222
                ▼
┌─ THE FAUX SERVER (the library) ───────────────────────────┐
│   speechcoach-deploy-target container                     │
│   /srv/speechcoach/{shared,releases,current,history}      │
└───────────────────────────────────────────────────────────┘

  ( the APP REPO is the book being delivered — api/ )
```

**The single most useful thing to hold onto:** GitHub never touches your server.
It only ever talks to the *worker*. The worker does the delivering. That is the
entire reason the runner has to be self-hosted — a rented worker in GitHub's
warehouse has no route into your bedroom.

---

## 2. The recipe cards — `.github/workflows/`

### The idea

A **workflow** is a recipe card filed at the dispatch office. It says *when* to
act and *what* to do. A **job** is one section of the card, done by one worker.
A **step** is one instruction inside a section.

Two cards exist:

| File | When it fires | Who does the work |
|---|---|---|
| `ci.yml` | every push, every PR | GitHub's rented workers |
| `deploy.yml` | push to `master` only | rented worker, then **your Mac** |

### What you did — `ci.yml`

Added one line:

```yaml
on:
  push:
  pull_request:
  workflow_call:      # <- this one
```

`workflow_call:` means *"another card is allowed to call me as one of its
sections."* Without it, `deploy.yml` cannot reuse your tests and you'd have to
copy-paste the whole test job — which then drifts out of date.

Adding it changes nothing about the existing triggers. They're independent.

### What you did — `deploy.yml`

Line by line, because every line is load-bearing:

```yaml
on:
  push:
    branches: [master]        # WHEN. Not `main` — this repo's default is master.
    paths-ignore: ['**.md']   # a docs-only commit shouldn't touch the server
  workflow_dispatch:          # lets you re-run by hand from the Actions tab

concurrency:
  group: deploy-production    # a name. Only one run in this group at a time.
  cancel-in-progress: false   # NEVER kill a deploy mid-flight: half-copied
                              # files, half-run migrations.
  queue: max                  # queue them up instead of cancelling the pending
                              # one (the default `single` would silently skip
                              # the middle commit of three rapid pushes)

jobs:
  ci:
    uses: ./.github/workflows/ci.yml    # section 1: run the tests

  deploy:
    needs: ci                            # <- THE GATE. No green, no delivery.
    runs-on: [self-hosted, macOS, ARM64] # <- WHICH WORKER (your Mac)
    environment: production              # <- THE BADGE (unlocks the cabinet)
    steps:
      - uses: actions/checkout@v7        # get the code
      - name: Deploy
        env:                             # hand the keys to the script
          DEPLOY_HOST:     ${{ vars.DEPLOY_HOST }}
          DEPLOY_KEY:      ${{ secrets.DEPLOY_KEY }}
          DEPLOY_HOST_KEY: ${{ secrets.DEPLOY_HOST_KEY }}
        run: ./scripts/deploy.sh
```

Three lines carry the whole design:

- **`needs: ci`** — the gate. Delete it and you have a machine that reliably
  ships broken code. Never "fix" a red pipeline by adding `if: always()`.
- **`runs-on`** — picks the worker by label. All labels must match.
- **`environment: production`** — the badge. Without it the job runs but gets
  *empty* secrets, and fails in a way that looks like a key problem.

### Check it

```bash
grep -A3 '^on:' .github/workflows/ci.yml     # workflow_call: present?
grep -E 'needs:|runs-on:|environment:' .github/workflows/deploy.yml
```

---

## 3. The worker — the self-hosted runner

### The idea

A worker who sits by the phone waiting for dispatch to call. GitHub has
warehouses full of them, but **none of them can reach your laptop**, and your
library is on your laptop. So you hired one who lives at your address.

### What you did

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
# download + untar from the page at Settings -> Actions -> Runners -> New
./config.sh --url https://github.com/mkcheung/Instruction-Speeches-Library --token XXXX
./run.sh
```

Two things that matter:

**Install it OUTSIDE the repo.** GitHub's copy-paste starts with
`mkdir actions-runner && cd actions-runner`, which would unpack it into whatever
directory you're standing in. If that's your repo, you get thousands of
untracked files and `_work/` holding a copy of the repo inside itself.

**Accept the default labels.** `config.sh` prints `self-hosted`, `macOS`,
`ARM64`. Those three are what `runs-on` matches on. Labels are case-insensitive,
and GitHub does *not* verify they're true — you could label a Linux box `macOS`
and it would match.

**Do not run `./svc.sh install`.** That makes it a background service surviving
reboots. On a public repo, that turns a short supervised window into a permanent
open door.

### Check it

```bash
pgrep -fl 'Runner.Listener' >/dev/null && echo "listening"
cat ~/actions-runner/.runner        # which repo + runner name it registered as
```
The UI (Settings → Actions → Runners) must show a green dot and **Idle**.
"Offline" means `./run.sh` died.

---

## 4. The key cabinet — the `production` environment

### The idea

Your shop has a cabinet holding the safe key.

**Without an environment**, the cabinet is unlocked: every job in every workflow
can take the key. Nothing breaks — it's just that nothing is stopping them.

**With an environment**, the cabinet has a lock and a rule painted on it:
*only opens for someone wearing the `production` badge, and only for work that
came from `master`.* Every opening is written in a book.

That's the whole feature. An environment is **not a place** and nothing is
installed anywhere. It is a lock plus a rule plus a logbook.

### What you did

Settings → Environments → New environment → `production`, then inside it:

| What | Name | Value | Why this type |
|---|---|---|---|
| Environment **secret** | `DEPLOY_KEY` | the private key file | must be hidden; anyone with it can deploy |
| Environment **secret** | `DEPLOY_HOST_KEY` | `ssh-ed25519 AAAA…` | public info really; secret for tidiness |
| Environment **variable** | `DEPLOY_HOST` | `127.0.0.1` | **not** a secret — see below |
| Deployment branches | — | `master` | the second lock |

**Why `DEPLOY_HOST` is a variable, not a secret.** GitHub blanks out any text
matching a secret, everywhere, in every job. Make `127.0.0.1` a secret and
unrelated log lines sprout `***` and you'll think something is broken.

**Why environment secrets, not repository secrets.** A repository secret is the
unlocked cabinet: readable by any job in any workflow — including `ci.yml`,
which runs on pull requests from strangers, and including third-party actions
you didn't write. The risk isn't a colleague you don't trust; it's that *a
workflow file is not the same thing as you*.

### Check it

- The `ci` job gets **nothing** — it has no badge. If you ever put
  `echo "${{ secrets.DEPLOY_KEY }}"` in `ci.yml` you'd get a blank line, not
  `***`, because there was never anything there to redact.
- After a deploy, the repo homepage sidebar shows **Environments → production**
  with a deployment history. That logbook is what an environment gives you that
  a plain secret never does.

---

## 5. The three values, and why there are three

This trips everyone up because two of them have "KEY" in the name and do
opposite jobs.

| | Question it answers | Whose identity | Which half |
|---|---|---|---|
| `DEPLOY_HOST` | **Where do I go?** | — | it's an address |
| `DEPLOY_HOST_KEY` | **Is what I found genuine?** | the **server's** | the **public** half |
| `DEPLOY_KEY` | **Will it let me in?** | **yours** | the **private** half |

Address → verify → enter.

**You only generated one of them.** `bin/keygen.sh` made your keypair. The
*server* generated its own host key on first boot (in `entrypoint.sh`) — you
only looked at it and wrote it down.

**`DEPLOY_HOST_KEY` does not choose the destination.** It audits the one
`DEPLOY_HOST` sent you to. That's exactly why it stops an attack: someone can
hijack the address, but they cannot produce the matching private half of the
server's identity.

The protection isn't secrecy — the host key is public, anyone can ask the server
for it. The protection is **commitment**: you pinned what the server looked like
when you knew it was the right one. That's why `StrictHostKeyChecking=no`, or
re-scanning the key every run, is worthless: both mean "trust whatever answers
today", and all the value was in having decided yesterday.

### Two different failures

| Broken | Error | Means |
|---|---|---|
| `DEPLOY_KEY` | `Permission denied (publickey)` | the lock didn't open for you |
| `DEPLOY_HOST_KEY` | `REMOTE HOST IDENTIFICATION HAS CHANGED!` | not the building in your photo |

---

## 6. One deploy, traced end to end

What actually happened when you merged PR #3:

1. **You clicked Merge.** A new commit `1fed584` landed on `master`.
2. **Dispatch noticed.** `deploy.yml` says `on: push: branches: [master]`. Match.
3. **`concurrency` checked** — no other deploy running, so proceed.
4. **Section 1 (`ci`) went to a rented worker.** Green in ~46 s.
5. **`needs: ci` satisfied**, so section 2 is released. *This is the gate.* Had
   the tests failed, everything below would simply never have happened.
6. **Section 2 (`deploy`) needed a worker with `self-hosted` + `macOS` +
   `ARM64`.** Your Mac. `./run.sh` printed `Running job: deploy`.
7. **The badge was checked.** Job says `environment: production`; the
   environment says "master only". Both pass → cabinet opens, the two secrets
   and the variable are handed over as env vars.
8. **`actions/checkout@v7`** cloned the repo fresh into `~/actions-runner/_work`.
9. **`./scripts/deploy.sh` ran**, and did:
   - wrote `DEPLOY_KEY` to a temp file, `chmod 600`
   - built a `known_hosts` line from `DEPLOY_HOST_KEY`
   - preflight: php + rsync present? `shared/.env` present?
   - `rsync` of `api/` into a **brand-new** `releases/<stamp>-1fed584/`
   - copied `vendor/`, linked `.env` and `storage`, fixed permissions
   - `php artisan migrate --force`
   - **`mv -T current.tmp current`** ← the one line that changes what is live
   - appended to `history`, reloaded php-fpm, pruned to 5 releases
   - deleted the temp key
10. **Dispatch wrote the logbook entry** under Environments → production.

The live release ended up named `20260808205125-1fed584` — the timestamp plus
the merge commit's fingerprint. That's how you know the delivery came from
GitHub and not from your own terminal.

---

## 7. Do it yourself, from zero

The order matters. Later steps depend on earlier ones existing.

**On your machine**
1. `cd ../speechcoach-deploy-target && ./bin/keygen.sh`
2. `docker compose up -d --build`
3. `./bin/provision.sh`
4. `ssh -i docker/sshd/deploy_key -p 2222 deploy@127.0.0.1 whoami` → `deploy`
5. From the app repo, prove **red before green**:
   `DEPLOY_HOST=203.0.113.99 ./scripts/deploy.sh` → 255 in ~10 s, nothing written

**On GitHub** (Settings → …)
6. Actions → General → **Require approval for all external contributors**
7. Environments → New → `production`
8. Add secrets `DEPLOY_KEY`, `DEPLOY_HOST_KEY`; variable `DEPLOY_HOST`
9. Deployment branches → Selected → `master`
10. Actions → Runners → New self-hosted runner → macOS/ARM64 → install in
    `~/actions-runner`, defaults for all four prompts, then `./run.sh`

**In the repo**
11. `workflow_call:` in `ci.yml`
12. Write `deploy.yml`
13. Push, open a PR, watch `CI / test` go green, merge
14. Watch `./run.sh` pick up `deploy`

**Afterwards**
15. Ctrl-C the runner; `./config.sh remove --token <token>` when finished

### Getting the values

```bash
# DEPLOY_HOST_KEY (safe to display — it's public)
ssh-keyscan -p 2222 -t ed25519 127.0.0.1 | cut -d' ' -f2-

# DEPLOY_KEY (never display — straight to clipboard)
pbcopy < ~/SideProjects/speechcoach-deploy-target/docker/sshd/deploy_key

# DEPLOY_HOST
echo 127.0.0.1
```

---

## 8. When it goes wrong

| Symptom | Cause |
|---|---|
| `deploy` job sits at **Queued** forever, nothing red | Runner not running, or `runs-on` labels don't match |
| `Permission denied (publickey)` | `DEPLOY_KEY` wrong/malformed — or, locally, `ssh $VAR` not word-splitting under zsh |
| `Host key verification failed` | `DEPLOY_HOST_KEY` doesn't match the server. Correct behaviour! |
| `Load key: invalid format` | key pasted with CRLF, or missing BEGIN/END lines |
| Secrets are empty in the job | job is missing `environment: production`, or the branch isn't `master` |
| Deploy is green but your code isn't live | `vendor` got symlinked instead of copied |
| `Merging is blocked — 1 approving review required` | You can't approve your own PR. Tick bypass, or drop the rule |
| Deploy never triggers, no error anywhere | `branches: [main]` instead of `master` |

### Verify a deploy actually deployed

```bash
ssh -i ~/SideProjects/speechcoach-deploy-target/docker/sshd/deploy_key -p 2222 \
  deploy@127.0.0.1 'cd /srv/speechcoach/current && php -r "
    require \"vendor/autoload.php\";
    echo (new ReflectionClass(\"App\\\\Models\\\\User\"))->getFileName(), PHP_EOL;"'
```
Must print a path under `/srv/speechcoach/releases/…`. If it says
`/var/www/html/…`, the deploy is green and **meaningless**.

---

## 9. The five sentences

1. **GitHub watches, and hands out job cards.** It never touches your server.
2. **The runner is a worker at your address**, because rented workers can't
   reach your laptop.
3. **`needs: ci` is the gate** — no green, no delivery. It is the whole point.
4. **The environment is a locked cabinet**, and `environment: production` is the
   badge on the one job allowed to open it, from `master`, with a logbook.
5. **The deploy never edits what's live.** It builds a new release beside it and
   moves one symlink. That's why a half-finished deploy can't exist.
