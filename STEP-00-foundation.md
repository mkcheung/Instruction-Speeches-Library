# Step 00 — Foundation and the spike wall

**Duration:** 1 week · **Depends on:** nothing · **Unblocks:** [01](STEP-01-identity.md)
**Plan:** [§12 S0](MODERNIZATION_PLAN.md) · [§21 Docker](MODERNIZATION_PLAN.md) · [§8.2 the engine](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished

> Open `/__spikes` in Chrome and Safari, press play on a video the server presigned, scrub it, and read a table of measured cue-boundary latency per browser.

This is the one step whose output is not a feature — and it is still the most visible foundation available, because it **renders** the answers to the two biggest technical unknowns rather than filing them in a document.

### Demo script

1. `docker compose up` — four services come up healthy.
2. Open the SPA. A health tile shows green, having called the API **with credentials**.
3. Open `/__spikes`. A `<video>` element plays a file you placed in SeaweedFS by hand, over a presigned URL.
4. **Drag the scrubber to 60%.** It seeks — which proves `Range` requests work end to end, in a real browser, not in `curl`.
5. Below it, a table: cue-boundary latency in milliseconds for `texttrack`, `requestVideoFrameCallback` and `timeupdate`. **In Safari too.**
6. Commit that table. It is the input to a decision you make in step 06.

## Backend

- Scaffold `api/` (Laravel 13) and `web/` (Vite + React 19 + TS) beside the archived legacy tree.
- **A hand-written `compose.yaml`** with four services — `app`, `web`, `postgres`, `seaweedfs` — plus the multi-stage Dockerfile and `.dockerignore` (§21). **Not Sail.**
- Pint, Larastan 5, Pest, ESLint flat config, Vitest, GitHub Actions.
- Health endpoint.
- A presigning route bound to `Storage::temporaryUrlUsing()` **from the first commit** — §10.5's rule, taken literally.

## Frontend

- Tailwind 4 + shadcn with design tokens.
- A dev-only `/__spikes` route behind the same double env guard §19 specifies, aborting **404** rather than 403.
- Three panels:
  1. Health + credentialed fetch.
  2. A `<video>` pointed at a presigned GET, with a scrub harness.
  3. `normalize` / `computeActive` / `timingSignature` — **the pure half of §8.2, which has zero backend dependency** — driven over that video from a fixture array and instrumented to report cue-boundary latency for all three drivers.

## Deliberately stubbed

No auth, no users, no schema beyond the framework's own. The video is a file someone put there by hand. The overlay is fixture data — unstyled, unpersisted.

## Containers introduced

`app`, `web`, `postgres`, `seaweedfs`. **Teaches:** services, the default network, name-based DNS, ports, the first named volume.

⚠️ **Do not bind-mount the Postgres data directory** — named volume only (§21.3).

## Acceptance

- [ ] `docker compose up` brings all four services healthy; the SPA calls the health endpoint with credentials
- [ ] `curl -H 'Range: bytes=0-1023'` against a presigned GET returns **`206` with a correct `Content-Range`**
- [ ] The same object **seeks correctly inside a real `<video>` in Chrome and Safari** — this is the version of the spike that matters
- [ ] `AWS_USE_PATH_STYLE_ENDPOINT` is proven necessary or not, **in writing**
- [ ] The presigned GET carries an `Origin` header against bucket CORS without failing (§8.7's untested combination)
- [ ] Measured cue latency for all three drivers is **committed to the repo**
- [ ] CI green

## Why this step exists

**R2 (presigned `Range`) and R1 (WebKit `cuechange`) are the two highest-impact technical unknowns in the risk register**, and both are answered here — in week 1, in a browser. Revision 4 answered R2 with `curl` and left R1 to week 13.

If R2 fails, the fallback is `X-Accel-Redirect` behind the same config value (§9.3), and finding that out now costs a day rather than a rewrite.

---

## 🎓 Optional next: [CP-00](CP-00-first-workflow.md)

| | |
|---|---|
| **Learn** | Your first workflow — what CI actually is |
| **Track** | CI |
| **Time** | ~2h |

**This is optional.** [Step 01](STEP-01-identity.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
