# Step 14 — Production hardening of the deploy

**Duration:** 1–1.5 weeks · **Depends on:** [02](STEP-02-first-deploy.md), [11](STEP-11-privacy-erasure.md) · **Unblocks:** nothing
**Plan:** [§12 S14](MODERNIZATION_PLAN.md) · [§14 observability](MODERNIZATION_PLAN.md) · [§21 containers](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished

> Watch a commit reach staging on its own, **watch a backup come back from the dead**, and see the first deliberately-thrown error land in GlitchTip.

This step has **no new feature** — it is infrastructure by definition. Its artifact is arguably the most visible thing in the plan: **a staging URL you can send someone.**

### Demo script

1. Push to `main`. **Watch the GitHub Actions run.** It reaches **staging** — a separate environment from production, which did not exist until now.
2. Open the staging URL. It is the whole product.
3. Open **Horizon**. Queue depth, throughput, failed jobs. Point at it and say what the transcode work did.
4. Deliberately throw an exception. **It appears in GlitchTip** — with a correlation ID that also appears in the JSON log, so you can pivot from one to the other.
5. Open **Uptime Kuma**. Green. Then open the free external check you paired it with — because monitoring from the same box tells you nothing when the box dies.
6. **Restore last night's backup into a scratch environment.** Time it. **Write the elapsed time next to the RTO you claimed.**

## Backend

Promote [step 02](STEP-02-first-deploy.md)'s skeleton to a production deploy:

- **Staging *and* production**, as separate environments.
- Object-storage lifecycle rules and CORS in the real bucket.
- Queue workers under `systemd` with the §9.2 limits.
- Valkey. The scheduler.
- ⚠️ **Backups with a restore drill and a stated RPO/RTO.** An untested backup is not a backup.
- GlitchTip and Uptime Kuma.
- Upload rate limiting.
- Larastan to **level 8**.

## Frontend

Error boundaries with real fallbacks. The GlitchTip SPA DSN.

## Deliberately stubbed

No CDN, no autoscaling, no blue-green. **One box** — and §15 is honest that the **concurrency-1 transcode worker is the component that genuinely does not scale.** If this ever takes real traffic, transcoding is the first thing you buy.

## Containers introduced

`glitchtip`, `uptime-kuma`. **Teaches:** Compose **profiles**, so the observability stack does not run on your laptop by default.

## Acceptance

- [ ] A commit to `main` reaches **staging** automatically and runs migrations
- [ ] ⚠️ **A backup is restored into a scratch environment successfully**, and the **elapsed time is written down next to the claimed RTO**
- [ ] A deliberately-thrown exception appears in GlitchTip **with a correlation ID that also appears in the JSON log**
- [ ] ⚠️ **Uptime Kuma is paired with a free external check** — monitoring from the same box tells you nothing when the box dies
- [ ] Horizon shows queue depth and failed jobs for both queues (transcode and captions)

## Watch for

⚠️ **Migrations must not run from a container entrypoint** (§21.5). With one container it works; with two they race. Run them as a **separate one-shot step** before the new containers serve traffic.

⚠️ **If sessions ever move to Valkey**, `maxmemory-policy` **must** be `noeviction`, and it must not share an instance with Horizon. On `allkeys-lru`, memory pressure evicts session keys and users are logged out at random with no error anywhere — and eviction also silently destroys queued jobs. §10.3's `database` session driver is the safer default; stay there until measurement says otherwise.

**R8: free hosting tiers shrink.** Oracle's Always Free halved in June 2026 with no announcement. Keep the app stateless so the host is a config change, and budget for a small VPS as the fallback.

**CI should build and test the same image that deploys**, or CI is testing something else.

---

## 🎓 Optional next: [CP-14](CP-14-sharding-and-speed.md)

| | |
|---|---|
| **Learn** | Sharding and wall-clock time |
| **Track** | CI |
| **Time** | ~3h |

**This is optional.** [Step 15](STEP-15-accessibility.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
