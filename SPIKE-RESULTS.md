# Step 00 spike results — cue-boundary latency

Measured from `/__spikes`'s `CueTimingPanel`, against `spikes/sample.mp4` (a real ~9s H.264/AAC MP4), fixture cues `cue-1@2s`, `cue-2@6s`, `cue-3@11s`. This is the input to the driver decision in step 06 (§8.2).

## Safari

| Driver | Samples | Avg latency (ms) |
|---|---|---|
| texttrack | 3 | 118.76 |
| rvfc | 3 | 23.43 |
| timeupdate | 3 | 118.43 |

## Chrome

| Driver | Samples | Avg latency (ms) |
|---|---|---|
| texttrack | 3 | 5.83 |
| rvfc | 3 | 11.50 |
| timeupdate | 3 | 69.21 |
