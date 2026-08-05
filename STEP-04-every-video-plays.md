# Step 04 — Every video plays

**Duration:** 1.5–2 weeks · **Depends on:** [03](STEP-03-upload-and-watch.md) · **Unblocks:** [09](STEP-09-captions.md), [13](STEP-13-social-layer.md)
**Plan:** [§12 S4](MODERNIZATION_PLAN.md) · [§5.6 transcode](MODERNIZATION_PLAN.md) · [§9.2 queue](MODERNIZATION_PLAN.md) · [§9.5 posters](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished

> Upload the **unmodified .MOV straight off an iPhone**, watch it play in Chrome, and see a real thumbnail of yourself in the list.

### Demo script

1. Take a video on an iPhone. **Do not convert it.** AirDrop it to your laptop and upload it as-is.
2. The card says "3 videos ahead of yours" — a number, not a mystery.
3. It transcodes. It plays. In Chrome **and Safari**.
4. **The thumbnail is a real frame of you**, not a black rectangle and not a placeholder.
5. Shoot a **portrait** video. Upload it. The thumbnail is portrait, not sideways.
6. Go back to the file that failed in step 03. **Press its Retry button.** It now works.
7. Click "use current frame" while watching, or pick from the sprite strip. The thumbnail changes.

## Backend

- The full `FfmpegTranscoder`: HEVC → H.264, 10-bit HDR tonemap, >1080p downscale **in the same pass**, display-matrix rotation handled once.
- The §9.2 queue configuration **in full** — separate worker processes, a `redis-long` connection with `retry_after => 3900` **above** `$timeout`, `$failOnTimeout = true`, `WithoutOverlapping` keyed on asset id, concurrency 1, `nice -n 19`, `-threads 2`, `CPUQuota=150%`.
- All five idempotency guarantees including the exit guard under `lockForUpdate()`.
- The poster pipeline (§9.5): one master JPEG at `SEEK` = 10% of duration clamped to `[2s, 30s]`, with **`-ss` before `-i`**; three widths × two formats; the 640w WebP as the single primary; plus the sprite strip.
- Global free-space watermark (R10).

## Frontend

- **Queue-depth backpressure** — "3 videos ahead of yours" from `Redis::llen`, which turns a mysterious twenty-minute wait into a number.
- Posters on cards and on `<video poster>`, via `<picture>`/`srcset` with `loading="lazy"`, `decoding="async"` and **explicit `width`/`height` from the asset row**.
- "Use current frame" and the sprite-strip frame picker.

## Deliberately stubbed

Captions still absent — [step 09](STEP-09-captions.md), for R11's reason. No AVIF. **No "upload your own poster image"** — §9.5 defers it on moderation grounds, because an abusive image renders *in a list next to other people's names* with no click required.

## Containers introduced

`ffmpeg-worker`. **Teaches:** resource limits (`cpus`, `mem_limit`), and a licensing boundary expressed as a build decision.

⚠️ **Built from a distro package, and never pushed to a registry.** §5.6: FFmpeg with `--enable-gpl` (needed for libx264) triggers GPL obligations **on distributing the binary, not on running it**. Keeping it in its own unpublished container keeps that boundary crisp.

## Acceptance

- [ ] Two speeches — **one an unmodified iPhone HEVC/.MOV** — both play in Chrome **and Safari**
- [ ] A transcode failure surfaces a Retry **that works**, re-using step 03's exact failed asset
- [ ] A **portrait** video produces a **portrait** poster, not a sideways one
- [ ] ⚠️ **No poster path is reachable unsigned** (R20) — a test asserts it, because this is the shortcut the feature actively invites
- [ ] **The poster does not flash mid-playback when the presigned URL refreshes** (§9.5's interaction with §9.3)
- [ ] Three simultaneous uploads do not drive load past the `CPUQuota`, and the web tier stays responsive — **measured, not assumed**

## Watch for

⚠️ **`-ss` must go *before* `-i`.** Before it, it is an input seek that jumps to the nearest keyframe; after it, an output seek that decodes every frame up to that point. On a 40-minute source that is 80 ms versus 30 seconds — **the most common mistake in poster pipelines.**

⚠️ **Posters are a still frame of an identifiable person's face.** They go through `Storage::temporaryUrlUsing()` like video, at a **1-hour** TTL (not the video's 10 minutes — there is no seek-refresh mechanism behind an `<img>`, so an expired `src` is a permanently broken image).

On macOS this step is slow: no VideoToolbox passthrough means software encoding. A five-minute 1080p HEVC source takes minutes. That is a fact to plan around, not a bug.

---

## 🎓 Optional next: [CP-04](CP-04-services-and-caching.md)

| | |
|---|---|
| **Learn** | Service containers, caching, and the codec trap |
| **Track** | CI |
| **Time** | ~4h |

**This is optional.** [Step 05](STEP-05-invitation-loop.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
