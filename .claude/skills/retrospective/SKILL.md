---
name: retrospective
description: Write a retrospective for a completed STEP or CP checkpoint in this repo (Instruction-Speeches-Library). Verifies claims against real repo state rather than conversation memory, states the next STEP by name, and names the CP checkpoint that follows per LEARNING-TRACK.md. User-invoked only — run as /retrospective after finishing a step, do not self-trigger.
---

# Retrospective

Produces `STEP-NN-RETROSPECTIVE.md` (or `CP-NN-RETROSPECTIVE.md`) at the repo
root for a just-completed STEP or CP checkpoint, matching the format of
`STEP-00-RETROSPECTIVE.md` and `STEP-01-RETROSPECTIVE.md`.

**This skill is invoked explicitly by the user (`/retrospective [id]`).** Do
not self-trigger it when a task merely looks "step-shaped" — accuracy here
depends on being run once, deliberately, after the work is actually done.

## 1. Identify the target

- If the user passed an id (e.g. `05`, `STEP-05`, `CP-03`), use it.
- Otherwise infer it: find the `STEP-NN-*.md` / `CP-NN-*.md` in the repo root
  with no matching `*-RETROSPECTIVE.md` yet, cross-checked against recent
  `git log` activity to confirm it's the one just worked on. If more than one
  candidate is ambiguous, ask the user rather than guessing.

## 2. Verify — do not recall

The user's explicit requirement is accuracy. Do not summarize from
conversation memory. Re-derive the state from ground truth:

- `git log` / `git diff` against the point the step started.
- Run the real test suites (backend: Pest/PHPUnit, `phpstan`, `pint`;
  frontend: Vitest, `tsc -b`, ESLint) and report actual pass/fail counts, not
  assumed green.
- For each item in the step's own acceptance list / demo script (in its
  `STEP-NN-*.md` or `CP-NN-*.md` file), check the concrete file, migration,
  route, or component named actually exists and does what's claimed — grep or
  read it, don't assert from what an agent said it built.
- Anything that can't be verified from here (e.g. needs a GUI browser, a human
  waiting 24h, real hardware) must be listed under "What was not verified,"
  not asserted as done. This is the load-bearing distinction the two existing
  retrospectives already draw — preserve it.

## 3. Write the retrospective

Follow the structure of `STEP-00-RETROSPECTIVE.md` / `STEP-01-RETROSPECTIVE.md`:

1. **Header** — step name, date executed, what it's graded against
   (`STEP-NN-*.md`, relevant `MODERNIZATION_PLAN.md` sections), method used
   (solo / parallel subagents / etc).
2. **What was accomplished** — grouped by area (e.g. `api/`, `web/`), citing
   concrete files/classes/migrations, not vague descriptions. Include the demo
   script actually walked, with real output, not a hypothetical one.
3. **Difficulties encountered** — real bugs hit and how they were found.
4. **Mistakes made** — anything wrong the first time and the actual fix,
   framed as a standing rule to carry forward if it generalizes.
5. **Package/tooling surprises** — anything the plan assumed that didn't match
   what actually installed/ran.
6. **What was not verified — and cannot be, from here** — the honest gap list
   from step 2 above.
7. **Next step** — read `STEPS.md` and name the next `STEP-NN-*.md` file
   explicitly, plus anything that must close before it's safe to call this
   step *fully* finished (per `STEPS.md`'s dependency graph — a step can be
   safe to start without every gap above being closed).
8. **Next CP checkpoint** — read `LEARNING-TRACK.md`'s table (`Step N → CP-N`
   is the checkpoint that runs immediately after step N, before step N+1) and
   name that checkpoint file explicitly, e.g. "Step 05 shipped; **CP-05 —
   two-users-one-test** is next per LEARNING-TRACK.md, before starting Step
   06." If the relevant CP has its own build-plan/status doc (as CP-02 does:
   `CP-02-BUILD-PLAN.md`, `CP-02-deployment-and-secrets.md`), note what phase
   of it is actually done vs. still open — don't just name the file.

## 4. Save, don't act

Write the file as `STEP-NN-RETROSPECTIVE.md` or `CP-NN-RETROSPECTIVE.md` at
the repo root. Do not:

- Edit code
- Commit or push
- Update `MODERNIZATION_PLAN.md`, `STEPS.md`, or memory files

Those are separate, explicit asks if the user wants them.
