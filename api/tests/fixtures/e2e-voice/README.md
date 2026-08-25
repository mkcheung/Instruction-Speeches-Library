# STEP-10 browser voice fixture

The voice-annotation E2E seeder deliberately reuses the repository's real,
redistributable `../whisper-smoke/spoken-fixture.m4a` rather than committing a
second copy of the same 155 KiB file. It is a valid, ~3.5-second, mono M4A
generated locally with macOS `say`; its full provenance and regeneration
instructions live beside that file.

Frozen SHA-256:

```text
45575a5b1578c40f8e6d9f3e54a458b755df30bc1a558aa39f3b093a71a39c3e  spoken-fixture.m4a
```

The deterministic browser `MediaRecorder` seam emits these exact bytes. The
application still performs a real multipart POST, Laravel stores the upload,
and the E2E normalization worker processes it. The shim proves the product's
MIME fallback wiring; it is not evidence of a real microphone or Safari/iPhone
MediaRecorder support.
