import { useEffect, useRef } from 'react'
import { normalize } from '@/lib/engine'
import type { Annotation } from '@/features/annotation/types'

const SUBTITLE_TRACK_LABEL = 'Commentary'

/**
 * MODERNIZATION_PLAN.md §8.3: "On iPhone, a `<video>` without
 * `playsinline` enters the native fullscreen player, in which HTML
 * overlays are not rendered at all... Handle it: listen for
 * `webkitbeginfullscreen`/`webkitendfullscreen`, and while native-
 * fullscreen enable a second track (`kind: 'subtitles'`, mode `showing`)
 * whose cues carry the annotation body text. The native player renders
 * it. You lose the fade and the stacking; you keep the feature."
 *
 * This is a SEPARATE, client-built `TextTrack` from the media pipeline's
 * own ASR captions (STEP-09) — its cues carry the annotation body, built
 * from the same JSON `OverlayStack`/`Transcript` render, not a `.vtt` file
 * on disk. Cached one-per-`<video>` in a `WeakMap` for the same reason as
 * the metadata track in `useTimedAnnotations` — `addTextTrack()` has no
 * DOM inverse.
 */
const subtitleTrackCache = new WeakMap<HTMLVideoElement, TextTrack>()

function getOrCreateSubtitleTrack(video: HTMLVideoElement): TextTrack {
  let track = subtitleTrackCache.get(video)
  if (!track) {
    track = video.addTextTrack('subtitles', SUBTITLE_TRACK_LABEL, 'en')
    // `addTextTrack` creates the track in `hidden` mode, which is enough
    // for video.js to list an empty "Commentary" entry in its captions menu
    // on every platform. It's only ever meant to be `showing` inside iOS
    // native fullscreen, so start it fully disabled.
    track.mode = 'disabled'
    subtitleTrackCache.set(video, track)
  }
  return track
}

function rebuildSubtitleCues(track: TextTrack, annotations: readonly Annotation[]): void {
  // `track.cues` is a live `TextTrackCueList` — repeatedly removing index
  // 0 drains it without needing a snapshot copy.
  while (track.cues && track.cues.length > 0) {
    track.removeCue(track.cues[0])
  }
  for (const a of annotations) {
    const n = normalize(a)
    if (!n) continue
    try {
      track.addCue(new VTTCue(n.start, n.end, a.body))
    } catch {
      // NaN/invalid start throws on construction — skip, same contract as
      // the metadata-track builder in useTimedAnnotations.
    }
  }
}

/**
 * Wires `webkitbeginfullscreen`/`webkitendfullscreen` on `videoEl` to a
 * client-built `kind="subtitles"` track carrying `annotations`' body text,
 * so the feature survives iOS's native-fullscreen player (which renders
 * no HTML overlay at all). Rebuilds the track's cues whenever the
 * annotation set changes (e.g. a reviewer switch while already in native
 * fullscreen), not only on entering fullscreen.
 */
export function useIosFullscreenSubtitles(
  videoEl: HTMLVideoElement | null,
  annotations: readonly Annotation[],
): void {
  const annotationsRef = useRef(annotations)
  useEffect(() => {
    annotationsRef.current = annotations
  })

  useEffect(() => {
    if (!videoEl) return

    const track = getOrCreateSubtitleTrack(videoEl)

    const onBeginFullscreen = () => {
      rebuildSubtitleCues(track, annotationsRef.current)
      track.mode = 'showing'
    }
    const onEndFullscreen = () => {
      track.mode = 'disabled'
    }

    videoEl.addEventListener('webkitbeginfullscreen', onBeginFullscreen)
    videoEl.addEventListener('webkitendfullscreen', onEndFullscreen)

    return () => {
      videoEl.removeEventListener('webkitbeginfullscreen', onBeginFullscreen)
      videoEl.removeEventListener('webkitendfullscreen', onEndFullscreen)
    }
  }, [videoEl])

  // Keep an already-showing track in sync when the annotation set changes
  // underneath it (reviewer switch mid-native-fullscreen) — otherwise the
  // subtitles would silently keep showing the previous reviewer's text.
  useEffect(() => {
    if (!videoEl) return
    const track = subtitleTrackCache.get(videoEl)
    if (track && track.mode === 'showing') {
      rebuildSubtitleCues(track, annotations)
    }
  }, [videoEl, annotations])
}
