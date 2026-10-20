import { useEffect, useState } from 'react'
import { AnnotationEditor } from '@/components/annotation/AnnotationEditor'
import { useAnnotationEditor, type UseAnnotationEditorOptions } from '@/hooks/useAnnotationEditor'
import { tmpAnnotationId } from '@/lib/uuid'

type ComposerProps = Omit<UseAnnotationEditorOptions, 'initial' | 'onCreated'> & {
  onLiveRemove: (id: string) => void
  onEditorReady?: (captureStart: () => void) => void
}

/** Each acknowledged creation gets a fresh UUID and form instance. */
export function Composer(props: ComposerProps) {
  const [generation, setGeneration] = useState(0)
  return <ComposerInstance key={generation} {...props} onCreated={() => setGeneration((value) => value + 1)} />
}
function ComposerInstance({ onEditorReady, onCreated, ...props }: ComposerProps & { onCreated: () => void }) {
  const editor = useAnnotationEditor({ ...props, initial: null, onCreated: (created) => {
    props.onLiveRemove(tmpAnnotationId(created.client_uuid)); onCreated()
  } })
  useEffect(() => { onEditorReady?.(editor.setToPlayhead) }, [onEditorReady, editor.setToPlayhead])
  return <AnnotationEditor editor={editor} label="New annotation" />
}
