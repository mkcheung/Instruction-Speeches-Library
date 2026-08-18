# E2E captions fixture media

`caption-fixture.mp4` — a synthetic 6-second, 640x360, H.264 (Constrained
Baseline profile), yuv420p, `+faststart` MP4 with a mono 44.1kHz AAC-LC
audio track (a 440Hz sine tone, not spoken audio).

## How it was made

Generated locally with `ffmpeg` via the `lavfi` test-source filters — no
external footage, no recording, no third-party asset of any kind:

```
ffmpeg -f lavfi -i "color=c=0x2b6cb0:s=640x360:d=6:r=25" \
       -f lavfi -i "sine=frequency=440:duration=6" \
       -c:v libx264 -profile:v baseline -pix_fmt yuv420p -movflags +faststart \
       -c:a aac -b:a 96k -shortest \
       caption-fixture.mp4
```

## Ownership / license

Wholly synthetic, generated for this repository. No copyright claims other
than the project's own; safe to commit and redistribute.

## Important limitation

**This file has no spoken audio** — only a sine tone. It is suitable for
every STEP-09 verification-plan use documented for it (browser playback,
seeking, native `<track>`/cue rendering, byte-range delivery through
SeaweedFS) because `E2ECaptionsSeeder` always pairs it with hand-authored
VTT/transcript rows rather than asking anything to transcribe it.

It is explicitly **not** suitable for the real Whisper smoke test
(STEP-09-VERIFICATION-PLAN.md §6.2/§6.3, "reuse it in the real Whisper
smoke if its speech is clear enough") — there is no speech to transcribe.
That smoke test needs its own separate short spoken-audio clip; do not
point it at this file.

## Cue timing contract

Every VTT this seeder writes for a fixture backed by this file places its
cues strictly inside `[0, 6)` seconds, matching this file's real duration —
required by STEP-09-VERIFICATION-PLAN.md §3.3 ("Cue and annotation times
must fall strictly inside the probed media duration").
