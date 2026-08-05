# CP-12 — Required checks: CI that can actually block you

> **Optional.** [Step 13](STEP-13-social-layer.md) does not depend on this.

**Track:** CI · **Time:** ~2h · **After:** [Step 12](STEP-12-admin-portal.md) · **Then:** [Step 13](STEP-13-social-layer.md)

---

## 🎯 What you are learning here

1. Why **CI that cannot block a merge is decoration**.
2. What branch protection actually does, and what it doesn't.
3. Why you should **protect yourself from yourself**, working alone.
4. Why a PR workflow is worth it with a team of one.
5. **What's available on your account tier** — a real constraint.

---

## Why a green check isn't enough

Up to now, CI has been *advisory*. It runs, it goes green or red, and **nothing stops you pushing anyway.**

On a good day that's fine. The problem is bad days: it's late, the change is small, the failure "looks unrelated," and you push. That is exactly the moment CI existed for, and it's the moment you'll override it.

**Branch protection removes the decision.** Not because you lack discipline — because a rule that depends on discipline at 11pm isn't a rule.

**And working alone makes this more important, not less.** You have no reviewer. Nobody else will notice the failing test. The automation is the whole safety net.

---

## Why a PR workflow with a team of one

It feels like ceremony. It isn't, and there are four concrete returns:

1. **CI runs before the code is on `main`**, not after. That's the difference between preventing and noticing.
2. **You get a diff view.** Reviewing your own PR catches genuine mistakes — debug logging, a commented-out line, a file you didn't mean to add.
3. **The PR is a place to write down why.** Six months later the commit says *what*; the PR says *what you were trying to do*.
4. **It's the workflow every team uses**, so the habit transfers.

---

## Setup — in order

### 1. Make sure CI runs on PRs

```yaml
on:
  push:
    branches: [main]
  pull_request:          # ← without this, a required check never runs
```

**⚠️ A required check that never runs blocks the PR forever**, with a message that isn't obvious. If your workflow only triggers on `push`, the check is *pending* eternally.

### 2. Turn on branch protection

Settings → Branches → Add rule for `main`:

- ✅ Require a pull request before merging
- ✅ Require status checks to pass — select your CI job by name
- ✅ Require branches to be up to date before merging
- ✅ **Do not allow bypassing the above settings** ← the important one

### 3. Prove it works

```bash
git checkout -b test-the-gate
# break a test deliberately
git commit -am "deliberately failing"
git push -u origin test-the-gate
gh pr create --fill
```

Open the PR. CI runs. Goes red. **Try to merge.**

**You can't.** That's the moment this checkpoint exists for.

### 4. Protect yourself from yourself

Without "do not allow bypassing," **you can merge anyway** — you're the repo owner, and GitHub shows an override.

Turn it on. The override disappears for you too.

> **Why this is the right call, not paranoia.** The override exists for genuine emergencies. But you are one person: you are the author, the reviewer *and* the admin. **If the override is available, it will eventually be used**, at the moment your judgment is worst. Removing it costs nothing on a normal day.

### 5. Add a PR template

`.github/pull_request_template.md`:

```markdown
## What this does

## Step / checkpoint
Closes part of STEP-XX.

## Acceptance criteria
- [ ] (paste from the step file)

## Manual checks CI can't do
- [ ] Verified on iOS Safari (if relevant)
```

**Why:** the step files already list acceptance criteria, and a template turns them into something you tick rather than something you remember.

---

## ⚠️ Tier limits — verify yours

> **Manual approval gates** (required reviewers, wait timers) are **public-repo-only** on Free, Pro and Team. **Pro does not unlock them for private repos** — that's Enterprise. Verified 2026-08-05, and it's the same limitation from [CP-02](CP-02-deployment-and-secrets.md).
>
> **Branch protection on a private repo with a Free account is a murkier question**, and I could not find a clean current statement. **Check yours directly before designing around it.**
>
> **The simple resolution:** make the repo **public**. Everything in this checkpoint works, it's free, and you're building this as a portfolio piece anyway. Just decide it deliberately.

---

## The nuances

**"Require branches to be up to date" has a real cost.** It means merging anything forces every other open PR to rebase and re-run CI. With one PR at a time it's free and it prevents the *semantic* merge conflict — two changes that merge cleanly and break together.

**Status check names come from the job name**, not the workflow. Rename a job and the required check silently stops matching — and the PR waits forever on a check that no longer exists.

**Required checks and matrix jobs:** each matrix combination is a separate check. Either require all of them or pick specific ones.

**Auto-merge** ticks the merge box in advance and merges when checks pass. Genuinely useful once CI takes a few minutes.

---

## ⚠️ You will hit this

**The check is pending forever.** No `pull_request` trigger, or a renamed job.

**You'll want to bypass it once, legitimately.** A docs typo, CI is broken for unrelated reasons. **Fix CI instead** — that's the muscle worth building.

**Merging becomes slower.** Correct. That slowness is the feature.

---

## Done when

- [ ] A PR with a failing test **cannot be merged**
- [ ] **It cannot be merged by you either**
- [ ] CI runs on `pull_request`, not just `push`
- [ ] A PR template exists and pulls in the step's acceptance criteria

Understanding:

- [ ] Why is CI without branch protection "decoration"?
- [ ] Why does working alone make this *more* important?
- [ ] Your required check is pending forever. Name two causes.
- [ ] What does "require branches to be up to date" prevent, and what does it cost?

---

**Next:** [Step 13 — The social layer](STEP-13-social-layer.md), then [CP-13](CP-13-visual-regression.md).
