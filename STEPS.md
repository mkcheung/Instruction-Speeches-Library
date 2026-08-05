# Implementation steps

The architecture, schema and reasoning live in **[MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md)**. These files are the **work orders** — what to build, in what order, and how to know it is finished.

**The rule every step follows:** at the end of it, there is something you can open in a browser and use. Fifteen of the sixteen manage that literally; the four that cannot are named honestly in [§12.2](MODERNIZATION_PLAN.md), and each still ends in an artifact a human can look at.

Every file carries a **Demo script** — the actual click-path to see the thing work. If you cannot follow it end to end, the step is not done.

| Step | You can… | Weeks | New container |
|---|---|---|---|
| [**00** Foundation](STEP-00-foundation.md) | Play and scrub a presigned video on a spike wall; read cue-latency per browser | 1 | `app`, `web`, `postgres`, `seaweedfs` |
| [**01** Identity](STEP-01-identity.md) | Register, verify email, complete a profile with avatar, visit `/u/yourname` | 2–2.5 | `mailpit` |
| [**02** First deploy](STEP-02-first-deploy.md) | Do all of that **on a real domain over TLS**, and stay logged in | 0.5–1 | — |
| [**03** Upload and watch](STEP-03-upload-and-watch.md) | Upload a video, kill your wifi, resume, play it back | 3–3.5 | `valkey`, `queue-worker` |
| [**04** Every video plays](STEP-04-every-video-plays.md) | Upload an **unmodified iPhone .MOV** and watch it play, with a thumbnail | 1.5–2 | `ffmpeg-worker` |
| [**05** Invitation loop](STEP-05-invitation-loop.md) | Invite someone by name; they accept and can watch — nobody else can | 2–2.5 | — |
| [**06** Watch commentary](STEP-06-watch-commentary.md) | Pick a reviewer's track and watch notes fade in and out on time | 2–2.5 | — |
| [**07** Write commentary](STEP-07-write-commentary.md) | Type at a timestamp, publish, and the speaker sees exactly that | 2–2.5 | — |
| [**08** The essay](STEP-08-essay.md) | Write a thousand words under the player, leave, return, publish | 1.5–2 | — |
| [**09** Captions](STEP-09-captions.md) | Turn on captions and fix the words Whisper got wrong | 1–1.5 | `whisper` |
| [**10** Voice annotation](STEP-10-voice-annotation.md) | Pause, speak a note, and hear it play while the video waits | 2 | — |
| [**11** Privacy and erasure](STEP-11-privacy-erasure.md) | Report a speech, export your data, delete your account | 2 | — |
| [**12** Admin portal](STEP-12-admin-portal.md) | Apply as a Coach with a PDF, get approved, appear in the directory | 2.5–3 | `clamav` |
| [**13** Social layer](STEP-13-social-layer.md) | Connect with someone and see your shared history | 2.5–3 | — |
| [**14** Deploy hardening](STEP-14-deploy-hardening.md) | Watch a commit reach staging, and a backup come back from the dead | 1–1.5 | `glitchtip`, `uptime-kuma` |
| [**15** Accessibility](STEP-15-accessibility.md) | Drive the annotation screen with a keyboard and a screen reader | 3–3.5 | — |
| | **Raw total** | **29.5–36** | |
| | **+15% contingency** | **34–41.5** | |

## The critical path

`00 → 01 → 03 → 05 → 06 → 07` is the genuinely serial spine — **11.5–14 weeks raw**, and the route to a working product. Everything else hangs off it.

**Note 04 is not on the spine.** Step 06 needs *a playing video*, which 03 already provides for compliant files. Real transcode blocks captions and posters, not the annotation loop.

```
00 ──► 01 ──┬──► 02 ─────────────────────► 14
            │
            ├──► 03 ──┬──► 04 ──┬──► 09 ──► 10
            │         │         └──► 13
            │         └──► 06 ──► 07 ──► 11 ──► 12
            └──► 05 ──┴──► 08                  │
                      └──► 13 ─────────────────┴──► 15
```

## If you need to cut

In order: **13 (social)** is the largest removable block and the core coaching product works without it. **08 (essay)** is next, but small and directly requested. **Do not cut 01's onboarding or 11's privacy work** — the first is what makes invitations usable, the second carries legal exposure.

## Reordering

**08, 12 and 13 are mutually independent** — any order works. If a demo audience matters most, 13 is the most impressive; if a moderator is waiting, 12. **09** is the cheapest to defer. **10** is the most self-contained step in the plan.

**Do not parallelize 06 and 07** with a second developer — they share the overlay component and the store shape, and two people writing `useTimedAnnotations` and the composer simultaneously will produce two disagreeing normalizations.

## 🎓 The parallel learning track

Alongside these steps runs **[LEARNING-TRACK.md](LEARNING-TRACK.md)** — sixteen CI/CD and Playwright checkpoints, **one between each step**.

**Every one is optional** — no build step depends on any of them. Each is its own file with explicit learning objectives, the reasoning behind each practice, runnable config, and predicted failures.

| Between | Checkpoint | Concept |
|---|---|---|
| 00 → 01 | [CP-00](CP-00-first-workflow.md) | What a workflow actually is |
| 01 → 02 | [CP-01](CP-01-codegen-then-refactor.md) | **Codegen, then refactor** — the core lesson |
| 02 → 03 | [CP-02](CP-02-deployment-and-secrets.md) | Deployment, secrets, environments |
| 03 → 04 | [CP-03](CP-03-debugging-failures.md) | Debugging a failure you cannot see |
| 04 → 05 | [CP-04](CP-04-services-and-caching.md) | Service containers and caching |
| 05 → 06 | [CP-05](CP-05-two-users-one-test.md) | Two users in one test |
| 06 → 07 | [CP-06](CP-06-testing-time-based-ui.md) | Testing time-based UI |
| 07 → 08 | [CP-07](CP-07-flakiness.md) | Flakiness, and why `sleep()` is a lie |
| 08 → 09 | [CP-08](CP-08-testing-rich-text.md) | Testing a rich-text editor |
| 09 → 10 | [CP-09](CP-09-matrix-builds.md) | Matrix builds |
| 10 → 11 | [CP-10](CP-10-faking-devices.md) | Faking a microphone |
| 11 → 12 | [CP-11](CP-11-isolation-and-parallelism.md) | Test isolation and parallelism |
| 12 → 13 | [CP-12](CP-12-required-checks.md) | Required checks |
| 13 → 14 | [CP-13](CP-13-visual-regression.md) | Visual regression |
| 14 → 15 | [CP-14](CP-14-sharding-and-speed.md) | Sharding and wall-clock time |
| after 15 | [CP-15](CP-15-accessibility-gates.md) | Accessibility as a gate |

**~51 hours total, spread across nine months.** A drip, not a bootcamp.

## Before you start any of them

Read [§12.1](MODERNIZATION_PLAN.md) — *decide the shape early, run the `ALTER` late*. Columns that carry an invariant ship with their table; denormalizations ship with the query that needs them. The **shape decisions locked at step 01** are listed there and should not drift.
