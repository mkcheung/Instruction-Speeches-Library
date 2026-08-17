import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  AlertDialogRoot,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog'
import { EssayToolbar } from '@/components/essay/EssayToolbar'
import { useEssayEditor } from '@/hooks/useEssayEditor'
import { useGetEssayQuery, usePublishEssayMutation } from '@/features/essay/essayApi'
import type { Essay } from '@/features/essay/types'
import type { Review } from '@/features/review/types'
import { cn } from '@/lib/utils'

/**
 * STEP-08-FROZEN-CONTRACT.md's `EssayEditorPanel` — the Essay tab's
 * content for the reviewer who owns this review. Fetches the essay once
 * (`getEssay`), then hands off to `EssayEditorPanelInner`, which is only
 * ever mounted with a resolved `Essay` — mirrors `AnnotationComposerPanel`
 * /`Composer`'s split of "own the query" from "own the per-instance
 * editor state."
 */
export function EssayEditorPanel({ speechId, review }: { speechId: number; review: Review }) {
  const reviewId = review.id
  const { data, isLoading, isError } = useGetEssayQuery({ speechId, reviewId })

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading your essay…</p>
  }

  if (isError || !data) {
    return (
      <p role="alert" className="text-sm text-[var(--color-danger)]">
        Could not load your essay. Try again.
      </p>
    )
  }

  return <EssayEditorPanelInner speechId={speechId} review={review} initial={data} />
}

function EssayEditorPanelInner({
  speechId,
  review,
  initial,
}: {
  speechId: number
  review: Review
  initial: Essay
}) {
  const reviewId = review.id
  const editorState = useEssayEditor({ speechId, reviewId, initial })
  const [publishEssay, { isLoading: isPublishing, isError: publishFailed }] = usePublishEssayMutation()

  // `immediatelyRender: true` is safe (and correct) here — this is a
  // client-only Vite app, never SSR'd, so there's no hydration mismatch to
  // guard against, and the explicit value silences @tiptap/react's dev
  // warning that would otherwise fire on every mount.
  const editor = useEditor({
    extensions: [StarterKit],
    content: initial.essay_html ?? '',
    immediatelyRender: true,
    onUpdate: ({ editor: e }) => editorState.setHtml(e.getHTML()),
  })

  // Programmatic content changes (a silent-adopt or an explicit "use
  // theirs"/"keep mine" from the conflict banner) originate OUTSIDE the
  // editor's own `onUpdate` — push them into the live TipTap instance.
  // `emitUpdate: false` stops this from looping back into `onUpdate` (which
  // would otherwise immediately re-mark the just-resolved editor dirty).
  useEffect(() => {
    if (!editor) return
    if (editor.getHTML() === editorState.html) return
    editor.commands.setContent(editorState.html, { emitUpdate: false })
  }, [editor, editorState.html])

  // STEP-08's unsaved-changes guard: block in-app navigation while a save
  // is still pending. `useBlocker` only covers client-side route changes;
  // the `beforeunload` listener below covers the tab-close/refresh case
  // `useAnnotationEditor.ts`'s pagehide beacon also has to handle.
  const blocker = useBlocker(editorState.autosaveState === 'dirty')

  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (editorState.autosaveState !== 'dirty') return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [editorState.autosaveState])

  const plainTextEmpty = !editor || editor.getText().trim().length === 0
  // Read straight off `initial` (not a local snapshot) — `EssayEditorPanel`
  // re-renders this component with a fresh prop every time `getEssay`
  // refetches, which `publishEssay`'s `invalidatesTags` triggers, so this
  // flips to `true` right after a successful publish without a remount.
  const isPublished = Boolean(initial.essay_published_at)

  const handlePublish = async () => {
    try {
      await publishEssay({ speechId, reviewId }).unwrap()
    } catch {
      // Surfaced via `publishFailed` below.
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Your essay</CardTitle>
          <CardDescription>A longer-form writeup, published separately from your notes.</CardDescription>
        </div>
        <span
          data-testid="essay-autosave-state"
          data-state={editorState.autosaveState}
          className={cn(
            'text-xs',
            editorState.autosaveState === 'conflict' && 'text-[var(--color-danger)]',
            editorState.autosaveState === 'offline' && 'text-[var(--color-danger)]',
            editorState.autosaveState === 'saved' && 'text-[var(--color-success)]',
            (editorState.autosaveState === 'idle' ||
              editorState.autosaveState === 'dirty' ||
              editorState.autosaveState === 'saving') &&
              'text-muted-foreground',
          )}
        >
          {editorState.autosaveState}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {editorState.speechDeleted && (
          <div
            role="alert"
            data-testid="essay-speech-deleted-banner"
            className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-2 text-sm"
          >
            This speech has been deleted. Your draft is preserved below.
          </div>
        )}

        {editorState.conflict && (
          <div
            role="alert"
            data-testid="essay-conflict-banner"
            className="flex flex-col gap-2 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-2 text-sm"
          >
            <p>Your essay changed elsewhere. Your text is safe — pick how to continue.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={editorState.keepMine}>
                Keep mine
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={editorState.useTheirs}>
                Use theirs
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={editorState.toggleShowBoth}>
                {editorState.showBoth ? 'Hide' : 'Show both'}
              </Button>
            </div>
            {editorState.showBoth && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded border border-border p-2">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Yours</p>
                  {/* Already sanitized server-side; the read-time
                      re-sanitization pass is the actual security boundary
                      (R14), not this render. */}
                  <div className="text-sm" dangerouslySetInnerHTML={{ __html: editorState.html }} />
                </div>
                <div className="rounded border border-border p-2">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Theirs</p>
                  <div
                    className="text-sm"
                    dangerouslySetInnerHTML={{ __html: editorState.conflict.essay_html ?? '' }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <EssayToolbar editor={editor} />

        <div className="rounded-lg border border-border p-3">
          <EditorContent
            editor={editor}
            data-testid="essay-editor-content"
            className="prose prose-sm max-w-none focus-within:outline-none [&_.tiptap]:min-h-40 [&_.tiptap]:outline-none"
          />
        </div>

        {publishFailed && (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            Could not publish. Try again.
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button
            type="button"
            disabled={plainTextEmpty || isPublishing || isPublished}
            onClick={() => void handlePublish()}
          >
            {isPublished ? 'Published' : isPublishing ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      </CardContent>

      <AlertDialogRoot
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset()
        }}
      >
        <AlertDialogPortal>
          <AlertDialogBackdrop />
          <AlertDialogPopup data-testid="essay-unsaved-changes-dialog">
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              Your essay is still saving. If you leave now, the last few words might not be kept.
            </AlertDialogDescription>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (blocker.state === 'blocked') blocker.reset()
                }}
              >
                Stay
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  if (blocker.state === 'blocked') blocker.proceed()
                }}
              >
                Leave
              </Button>
            </div>
          </AlertDialogPopup>
        </AlertDialogPortal>
      </AlertDialogRoot>
    </Card>
  )
}
