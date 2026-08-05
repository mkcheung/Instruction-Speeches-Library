# Step 09 — Captions

**Duration:** 1–1.5 weeks · **Depends on:** [04](STEP-04-every-video-plays.md) · **Unblocks:** [10](STEP-10-voice-annotation.md)
**Plan:** [§12 S9](MODERNIZATION_PLAN.md) · [§6.12 the speech transcript](MODERNIZATION_PLAN.md) · [§8.6 accessibility](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished

> Turn on captions, read what you said, **fix the three words Whisper got wrong** — and then **search across everything you've ever said.**

### Demo script

1. Upload a speech. It becomes playable in seconds (compliant) or minutes (transcoded).
2. **It is playable *before* captions are ready** — the player shows a "captions processing" affordance rather than blocking.
3. A few minutes later, the `CC` button lights up. Turn it on. Your words appear, styled by **your own browser caption settings**, not ours.
4. Whisper misheard "Toastmasters" as "toast masters". Open the **caption editor**, fix the line, save.
5. Play again. Fixed.
6. Open the **transcript view** — the whole speech as readable text. Click any line to jump there.
7. Search your speeches for a phrase you said. **The right speech comes back.**
8. Turn on a reviewer's commentary at the same time. **Captions sit at the bottom; the annotation overlay moves to the top.** They do not collide.
9. Toggle each independently.

## Backend

- `faster-whisper` or `whisper.cpp` on the extracted audio.
- ⚠️ **On a separate queue from transcode** (R11) — so a two-second remux still completes in seconds instead of waiting behind a five-minute transcription.
- WebVTT stored as a `captions` asset with `format='vtt'`.
- ⭐ **`speech_transcripts` parsed from that VTT** (§6.12): plain `body`, `segments` jsonb with timing, `word_count`, `words_per_minute`, `language`, `model`, and a **`tsvector` search index**.
- ⚠️ **The VTT stays canonical; the table is derived.** Editing captions re-derives the row and flips `source` to `edited`. **Never write back the other way** — two-way sync between a file and a row produces a speech whose captions and transcript disagree with no way to tell which is right.
- A speaker-editable VTT endpoint **with server-side VTT validation**, which dispatches the re-derive job.

## Frontend

- A real `<track kind="captions" default>` — so the browser's native renderer and **the user's own caption styling** apply. This matters: people who need captions have already configured how they want them.
- The caption editor — a timecoded list, same shape as the transcript list, saving back to the VTT.
- ⭐ **A readable transcript view** — the whole speech as text, click a line to seek.
- ⭐ **Search across your own speeches.** *"Which of my speeches mentioned the district final?"* One `tsvector` match on a GIN index.
- ⚠️ **The annotation overlay anchors to the top whenever captions are showing.** This is the rule coded-but-untriggered since step 06, now live. Native captions render bottom-centre; without this they overlap.

## Deliberately stubbed

No translation, no multi-language tracks, no speaker diarization.

**No filler-word or pace analysis yet.** §6.12 explains why the columns exist now and the analysis lands later as a small additive job reading a column that already exists. Do not let it grow into a scoring system — a number that looks like a grade demoralizes faster than a badly-balanced review does.

**§20 Q12 is answered here** by shipping automatic-with-an-off-switch — the answer that does not need re-litigating.

## Containers introduced

`whisper`. **The heaviest container in the stack** — a Python/CTranslate2 runtime plus hundreds of megabytes of model weights, on a box already running PostgreSQL, Valkey, PHP-FPM, SeaweedFS and FFmpeg.

**Teaches:** how to handle large model weights — ⚠️ **mount them as a volume rather than baking them into the image**, or every rebuild ships hundreds of MB.

**Raise Docker Desktop's memory allocation to ~12 GB before this step, not during it** (§21.3).

## Acceptance

- [ ] A speech from step 04 gains captions **without delaying its playback readiness** — measured: the video reaches `ready` **before** the caption job finishes
- [ ] Captions and annotations are on **different tracks** and toggle independently
- [ ] Editing a caption line persists and re-renders
- [ ] A speech whose caption job **fails still plays**; the failure is visible and retryable
- [ ] The model weights are **pinned by digest** and their licence terms recorded
- [ ] ⭐ **The transcript row exists**, and searching a distinctive phrase **finds the right speech**
- [ ] ⭐ **Editing a caption line re-derives the transcript** and sets `source = 'edited'`
- [ ] ⚠️ **`model` is recorded on every transcript** — a filler count is only comparable against another from the same model, so a model upgrade must not silently invalidate history

## Watch for

⚠️ **The model weights carry their own terms, separate from the library.** `faster-whisper` and `whisper.cpp` are MIT; the weights are what to check before any commercial use (§4).

**Why captions are not optional for this product specifically:** it is speech training. A deaf or hard-of-hearing member cannot use it at all without them. §8.6 also establishes that the **transcript list — not the overlay — is the authoritative accessible surface**, because a live region firing every few seconds over playing speech audio is a denial of service, not an accessibility feature.

---

## 🎓 Optional next: [CP-09](CP-09-matrix-builds.md)

| | |
|---|---|
| **Learn** | Matrix builds |
| **Track** | CI |
| **Time** | ~2h |

**This is optional.** [Step 10](STEP-10-voice-annotation.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
