# Step 03 — Upload and watch

**Duration:** 3–3.5 weeks · **Depends on:** [01](STEP-01-identity.md) · **Unblocks:** [04](STEP-04-every-video-plays.md), [05](STEP-05-invitation-loop.md), [06](STEP-06-watch-commentary.md)
**Plan:** [§12 S3](MODERNIZATION_PLAN.md) · [§9 media pipeline](MODERNIZATION_PLAN.md) · [§6.11 speech versioning](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished

> Upload a video, watch the progress bar, kill your wifi mid-upload, resume, play the result back with a working scrubber — and mark it as replacing an earlier attempt, with a note saying what you changed.

### Demo script

1. Upload a compliant H.264 file. Watch a real progress bar.
2. **Turn off your wifi at 40%.** Turn it back on. **The upload resumes** and completes.
3. The card shows `processing`, then `ready`. Play it. Scrub it. Works in Chrome **and Safari**.
4. Upload a second video. On the form, tick **"this replaces an earlier attempt"**, pick the first one, and write *"cut the third example."*
5. The card shows a **"v2 of"** badge.
6. Log in as a different Member. **Copy the presigned URL from the first user's page and paste it.** It does not work.
7. Upload an **unmodified iPhone .MOV**. It fails — **visibly**, with a message and a Retry button. That is deliberate; step 04 makes it work.

## Backend

- `speeches`, `speech_assets` with the `primary_flag` partial unique index and the `kind`↔`format` CHECKs.
- **`speeches.supersedes_id` and `change_note`** (§6.11) with the `< id` acyclicity CHECK and the successor unique index.
- Presigned S3 multipart — create / sign-part / complete / abort.
- The quota conditional UPDATE **and all four release paths**, `media:reconcile`, `MediaUrlSigner`, presigned GET at a 10-minute TTL with refresh-on-403.
- `TranscoderContract` bound to `FakeTranscoder` in CI and a **remux-only** `FfmpegTranscoder` in dev: probe with `ffprobe`; if h264+aac and ≤1080p, `-c copy -movflags +faststart`; otherwise `status='failed'` with a user-safe `failure_code`.
- `after_commit => true` on the queue from the first dispatched job.

## Frontend

- Uppy Dashboard with the multipart threshold at ~20 MB.
- The speech create form **including the "this replaces an earlier attempt" picker and the `change_note` field**.
- "My speeches" with `speech-card-status` rendering **every** state including `failed` with a Retry, and a **"v2 of" badge** on linked speeches.
- The player behind `shared/media/videojs-adapter.ts`.
- The **typographic no-poster placeholder** (§9.5) — the speech's initial on a hue derived from its ULID, at 16:9 — so a posterless card reads as intentional from day one rather than as a broken image.

## Deliberately stubbed

**The transcoder handles only files that are already compliant.** An iPhone HEVC/.MOV lands in a real, visible **Failed** state saying "we can't process this format yet", with a real Retry button.

That is not a shortcut — it is a **user-visible failure surface you have to build anyway**, standing in for a feature that arrives next step. Its Retry gets re-run as a passing test in step 04.

No posters. No captions. No HLS, ever. Queue depth is not surfaced yet.

## Containers introduced

`valkey`, `queue-worker`. **Teaches:** two containers from **the same image with a different command** — the cleanest illustration of image-versus-container there is.

## Acceptance

- [ ] A compliant H.264 file plays in **Chrome and Safari**
- [ ] **A speech can be linked to an earlier one by the same speaker**; linking to someone else's is refused by the service, and a cycle is refused by the `< id` CHECK
- [ ] A second Member cannot fetch it, **verified by hitting the presigned URL directly**
- [ ] Killing the network mid-upload and resuming **completes the file**
- [ ] ⚠️ **A client declaring a 1-byte size for a 40 MB file does not evade the quota** — completion reconciles by the real `byte_size`
- [ ] ⚠️ **Two abandoned uploads do not permanently lock a user out** — `media:reconcile` releases `uploads_in_flight`, not just the row
- [ ] An unmodified iPhone file **fails visibly** with a user-safe message and a working Retry
- [ ] Seeking past the 10-minute TTL refreshes the URL **and restores playback position**

## Watch for

⚠️ **The presigned-URL refresh handler is a spike, not settled design** (§9.3). An expired URL surfaces inside `<video>` as `MEDIA_ERR_NETWORK` with no HTTP status reachable from JavaScript, and reassigning `src` mid-playback loses position and re-buffers. **Prove the handler restores position before committing to a short TTL.**

On macOS, transcoding is software-only — Docker Desktop cannot pass through VideoToolbox (§21.3). This is why remux-only ships first: `-c copy` takes about a second regardless.

---

## 🎓 Optional next: [CP-03](CP-03-debugging-failures.md)

| | |
|---|---|
| **Learn** | Debugging a failure you cannot see |
| **Track** | Playwright + CI |
| **Time** | ~3h |

**This is optional.** [Step 04](STEP-04-every-video-plays.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
