import { useState } from 'react'
import { AnnotationEditor } from '@/components/annotation/AnnotationEditor'
import { useAnnotationEditor } from '@/hooks/useAnnotationEditor'
import { tmpAnnotationId } from '@/lib/uuid'
import type { Annotation } from '@/features/annotation/types'

/**
 * The "type at a timestamp" surface (STEP-07's demo script steps 2-3).
 * Each draft gets a FRESH `useAnnotationEditor` instance, keyed by an
 * incrementing counter — the moment one draft gets its first real server
 * id (`onCreated`), the composer remounts with a brand-new key rather than
 * reusing the same hook instance for the next note. This is what makes
 * "never reload a row back into the composer" true by construction: a
 * saved row's state and the composer's create-form state can never be the
 * same React state, because they're never the same component instance.
 */
export function Composer({
  speechId,
  reviewId,
  videoEl,
  autoPause,
  onLiveChange,
  onLiveRemove,
  onSaved,
  onSilentAdopt,
}: {
  speechId: number
  reviewId: number
  videoEl: HTMLVideoElement | null
  autoPause: boolean
  onLiveChange: (live: Annotation) => void
  /** Called with the OUTGOING draft's id right before the composer resets
   * to a fresh one, so the panel can drop the stale `tmp_…` override. */
  onLiveRemove: (id: string) => void
  onSaved?: (annotation: Annotation) => void
  onSilentAdopt?: (annotation: Annotation) => void
}) {
  const [generation, setGeneration] = useState(0)

  return (
    <ComposerInstance
      key={generation}
      speechId={speechId}
      reviewId={reviewId}
      videoEl={videoEl}
      autoPause={autoPause}
      onLiveChange={onLiveChange}
      onSaved={onSaved}
      onSilentAdopt={onSilentAdopt}
      onCreated={() => {
        setGeneration((g) => g + 1)
      }}
      onLiveRemove={onLiveRemove}
    />
  )
}

function ComposerInstance({
  speechId,
  reviewId,
  videoEl,
  autoPause,
  onLiveChange,
  onLiveRemove,
  onSaved,
  onSilentAdopt,
  onCreated,
}: {
  speechId: number
  reviewId: number
  videoEl: HTMLVideoElement | null
  autoPause: boolean
  onLiveChange: (live: Annotation) => void
  onLiveRemove: (id: string) => void
  onSaved?: (annotation: Annotation) => void
  onSilentAdopt?: (annotation: Annotation) => void
  onCreated: () => void
}) {
  const editor = useAnnotationEditor({
    speechId,
    reviewId,
    initial: null,
    videoEl,
    autoPause,
    onLiveChange,
    onSaved,
    onSilentAdopt,
    onCreated: (created) => {
      // The tmp id is deterministic from the client_uuid this same draft
      // minted, so there's no need to read it back off `editor` — avoids
      // any doubt about which render's closure is live when this fires.
      onLiveRemove(tmpAnnotationId(created.client_uuid))
      onCreated()
    },
  })

  return <AnnotationEditor editor={editor} label="New note" />
}
