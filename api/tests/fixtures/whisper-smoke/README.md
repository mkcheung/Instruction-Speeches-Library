# Real Whisper smoke fixture: `spoken-fixture.m4a`

A short, clearly-spoken English clip for `RealWhisperAdapterSmokeTest`
(STEP-09-VERIFICATION-PLAN.md §6.2) and the queued final-worker sign-off
(§6.3). Unlike `api/tests/fixtures/e2e-captions/caption-fixture.mp4` (sine
tone, no speech — see that fixture's own README), this file exists
specifically to be transcribed.

## Provenance — synthesized, not recorded or downloaded

No microphone recording and no third-party/downloaded audio of any kind
was used. This sandbox has no network access to fetch a licensed spoken
clip and no way to record real speech, so the file was synthesized
entirely locally with macOS's built-in `say` text-to-speech command (no
`ffmpeg`, no external service):

```
say -o spoken-fixture.m4a -v Alex \
    "Toastmasters helps people build confidence in public speaking."
```

`say` writes the AAC/ALAC-in-M4A container directly (confirmed via `file`
and `afinfo` on the generated output) — no separate mux step was needed or
used. Voice: `Alex` (macOS's default US English system voice).

## Technical details

- Container: ISO Media / M4A (audio-only, no video track).
- Duration: ~3.5 seconds (`afinfo` "estimated duration: 3.517732 sec") —
  within the plan's required 3-10 second window.
- Sample rate/channels: 22050 Hz, mono, 16-bit.
- `WhisperTranscriber` extracts a 16kHz mono WAV via `ffmpeg -vn ...`
  before ever invoking `whisper-cli`, so the source container/codec here
  only needs to be something `ffmpeg` can demux — it does not need to
  match the production upload pipeline's H.264/AAC MP4 shape the way
  `caption-fixture.mp4` does.

## Spoken content and keyword assertions

Literal phrase: **"Toastmasters helps people build confidence in public
speaking."**

`RealWhisperAdapterSmokeTest` normalizes whisper.cpp's output (lowercase,
strip punctuation) and requires a small SUBSET of
`["toastmasters", "confidence", "public", "speaking"]` to appear — not an
exact-transcript match, since ASR output for a synthesized voice is not
guaranteed to be byte-identical across whisper.cpp/model versions. This is
deliberately a coarse diagnostic per the verification plan ("do not
compare the full transcript or exact timestamps").

## Ownership / license

Wholly synthetic text-to-speech output generated for this repository using
software already installed on the build machine (macOS `say`). No
copyright claims other than the project's own; safe to commit and
redistribute. Not a recording of any real person.

## Regenerating

Re-run the `say` command above on any macOS machine (voice `Alex` ships
with the OS). If `Alex` is ever unavailable, list installed voices with
`say -v '?'` and substitute a comparably clear US English voice, then
re-verify duration stays inside 3-10 seconds with
`afinfo spoken-fixture.m4a`.
