# Voice upload MIME regression fixture

`opus-audio.webm` contains one second of a synthetic 440 Hz tone, generated
locally with FFmpeg. It contains one mono Opus audio stream and no video.
It is 9,987 bytes and contains no microphone recording or downloaded media.

The real uploaded file is detected by PHP Fileinfo as `video/webm`, although
the browser sends `audio/webm;codecs=opus`. The HTTP regression uses these
bytes without a fake MIME override to cover that mismatch.

Generate an equivalent fixture with:

```sh
ffmpeg -v error -f lavfi -i sine=frequency=440:duration=1 \
  -vn -ac 1 -c:a libopus -f webm pipe:1 > opus-audio.webm
```

SHA-256 of the committed fixture:

```text
8f4c15bf20c9f5ff638afce7c3fb44156ccd7de943de9e449ccfb6211fd990db
```
