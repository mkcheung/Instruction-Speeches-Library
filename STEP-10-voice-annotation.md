# Step 10 — Voice annotation

**Duration:** 2 weeks · **Depends on:** [07](STEP-07-write-commentary.md), [09](STEP-09-captions.md) · **Unblocks:** nothing
**Plan:** [§12 S10](MODERNIZATION_PLAN.md) · [§8.7 voice annotation](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished

> As a Coach, **pause the video, speak a note**, and on playback the video pauses at that moment, the note plays, and playback resumes.

### Demo script

1. As a **Coach** (Members cannot do this), open a speech you were invited to review.
2. Play to 2:30. **Pause.** A **Record ●** button appears beside the text composer.
3. Press it. Say *"your pause here was excellent — do more of that."* Press stop. A waveform appears.
4. Don't like it? **Re-record.** Costs nothing.
5. Publish the set.
6. Log in as the speaker. Play from the start.
7. At 2:30 the **video pauses by itself**, the coach's voice plays, and **when it finishes the video resumes.**
8. A few seconds before it, a marker on the scrubber warned you it was coming.
9. Press **Skip ▸** during a note. Playback resumes immediately.
10. **Pause manually while a note is playing.** When the note ends, the video **stays paused** — it does not override you.
11. Below the note, its **transcript**, so it works with the sound off.
12. **Do all of this on an iPhone.** It works.

## Backend

- `annotations.audio_asset_id` nullable FK, SET NULL.
- `voice_note` appended to `speech_assets.kind`; `m4a` to `format`.
- ⚠️ **Direct POST, not presigned multipart** — at ~480 KB a voice note is ~40× below the threshold where multipart pays for itself, and routing it through the API closes §9.1's "the client declares the byte count" hole structurally. **Do not touch `uploads_in_flight`.**
- Two-pass `loudnorm` with ⚠️ **`dual_mono=true`** — required for mono input; without it every note is systematically ~3 LU quiet — to AAC-LC mono 64 kbps.
- A Whisper transcript per note, **on the captions queue**.
- Coach-only policy gate.
- The erasure path **deletes the audio and keeps the transcript**.

## Frontend

- `MediaRecorder` with ⚠️ **construct-and-catch in a preference order** — there is no universal container. Firefox will not write MP4; Safari ≤ 18.3 will not write WebM; and `isTypeSupported()` has returned `true` on iOS where `start()` then threw. It is a filter, not an oracle.
- `wavesurfer.js` fed a **same-origin `blob:` URL**, so it never encounters the CORS problem.
- The pause-then-speak playback controller, with the `crossedNotes` function and its two boundary cases (§8.7).
- The transcript rendered under each note.
- A **mic-permission-denied state that explains itself**.

## Deliberately not built — and this is why it is 2 weeks and not 4.5

**No ducking. No `MediaElementAudioSourceNode`.** No drift watchdog, no `AudioContext` gesture chain, no decode cache, no scrub-into-a-note policy, no `playbackRate` pitch handling.

> §8.7 identifies `MediaElementAudioSourceNode` as a **hard blocker, not a caution**: cross-origin media passed to `createMediaElementSource()` produces **silence**, you cannot detect it in advance, and you cannot un-route it. Our media is cross-origin **by design**.
>
> **And the iOS hole disappears with them.** `HTMLMediaElement.volume` is a no-op on iOS Safari — Apple reserves volume for the hardware buttons — which only matters if you duck. We never duck.

## Containers introduced

None — reuses `ffmpeg-worker` and `whisper`.

## Acceptance

- [ ] A Coach records a 12-second note at 2:30. The speaker replays; the video pauses at 2:30, the note plays to completion, playback resumes — ⚠️ **verified on iPhone Safari**, which is where the overlay version would have been unfixable
- [ ] ⚠️ **A Member cannot attach a voice note — 403 by direct API call**, not just an absent button
- [ ] ⚠️ A **second** voice note on the same speech does not collide with the primary-asset unique index — a voice-note asset is **never `is_primary`**
- [ ] Recording succeeds in Firefox **and** Safari, proven with a **forced-failure test on the first MIME preference** so the fallback path is exercised rather than assumed
- [ ] A failed `audio.play()` **resumes the video rather than stranding it** (R22)
- [ ] ⚠️ **Erasing the coach's account deletes the audio object and preserves the transcript text**

## Watch for

**Transcripts are mandatory, and accessibility is not the strongest reason.** A coach's recorded voice **is that coach's personal data and cannot be anonymized.** §11.2 promises erasure that nulls authorship while preserving commentary text — **unkeepable for audio.** Without a transcript, one coach's erasure request destroys every piece of spoken feedback they ever gave, to every speaker, retroactively.

**The one real product risk (R23):** twelve voice notes on an eight-minute speech is twelve interruptions. Mitigations: warn the coach past ~6 notes with the total added time, and give the speaker a **Play commentary / Text only / None** switch. Watch it in use before adding a hard cap.

**This is the most self-contained step in the plan** — pause-then-speak has no coupling to the playback pipeline, so it can move anywhere after 07 and 09, or be dropped without consequence.

---

## 🎓 Optional next: [CP-10](CP-10-faking-devices.md)

| | |
|---|---|
| **Learn** | Faking a microphone |
| **Track** | Playwright |
| **Time** | ~3h |

**This is optional.** [Step 11](STEP-11-privacy-erasure.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
