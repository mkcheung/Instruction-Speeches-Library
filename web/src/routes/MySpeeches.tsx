import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuPopup,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { SpeechPoster } from '@/components/speech/SpeechPoster'
import { StatusBadge, SupersedesBadge } from '@/components/speech/StatusBadge'
import { SpeechEditDialog } from '@/components/speech/SpeechEditDialog'
import { SpeechDeleteDialog } from '@/components/speech/SpeechDeleteDialog'
import { useListSpeechesQuery } from '@/features/speech/speechApi'
import type { Speech } from '@/features/speech/types'
import { CardGrid } from '@/components/layout/PageShell'
import { NotebookPage } from '@/components/workspace/NotebookPage'
import { useWorkspaceCompanionScene } from '@/components/workspace/useWorkspaceCompanion'

/**
 * STEP-03-upload-and-watch.md's "my speeches" — "the card shows
 * `processing`, then `ready`" is a live transition the demo script watches
 * happen, not something that needs a manual page reload. Polls at a fixed
 * interval the whole time this page is mounted; RTK Query starts/stops the
 * poll automatically with the component, so there's nothing to tear down
 * by hand, and a background GET every few seconds is cheap enough not to
 * need the extra complexity of turning it off once everything settles.
 * `SpeechPoster` (STEP-04 §9.5) renders the real poster once one exists,
 * falling back to the same intentional-not-broken placeholder it always
 * has for speeches that don't have one yet.
 */
export default function MySpeeches() {
  const scene = useWorkspaceCompanionScene()
  const { data, isLoading } = useListSpeechesQuery(undefined, { pollingInterval: 3000 })

  if (isLoading) {
    return (
      <NotebookPage width="wide" scene={scene} title="My speeches">
        <p className="workspace-notebook-surface workspace-notebook-panel workspace-notebook-status text-sm text-muted-foreground">Loading…</p>
      </NotebookPage>
    )
  }

  const speeches = data?.speeches ?? []

  return (
    /* `wide`: this is a poster grid, the one content type that genuinely
       uses every pixel. It was previously capped at `max-w-3xl` with a
       two-column ceiling, so a 1920px window showed two cards and ~70rem
       of empty space. */
    <NotebookPage width="wide" scene={scene} title="My speeches"
      actions={
        <Button size="sm" className="workspace-notebook-control workspace-notebook-control--primary" render={<Link to="/speeches/new" />}>
          Upload a speech
        </Button>
      }
    >
      {speeches.length === 0 && (
        <p className="workspace-notebook-surface workspace-notebook-panel workspace-notebook-status text-sm text-muted-foreground">No speeches yet.</p>
      )}

      <CardGrid>
        {speeches.map((speech) => (
          <SpeechCard key={speech.id} speech={speech} />
        ))}
      </CardGrid>
    </NotebookPage>
  )
}

/**
 * §7.5 frontend: the owner menu lives in `CardHeader` via `CardAction` —
 * the slot `card.tsx` already builds for exactly this ("top-right of the
 * header, alongside the title"), so it introduces no second
 * `data-slot="card"` and leaves `Watch`'s own markup/position in
 * `CardContent` untouched. §12's frozen contract pins `Watch` as a link
 * scoped inside `[data-slot="card"]` (`captions.spec.ts:489-490`) — that
 * scoping still holds here, since `SpeechCard` renders exactly one `Card`.
 *
 * `SpeechEditDialog`/`SpeechDeleteDialog` are standalone and controlled
 * (not menu-item triggers) for the same reason `ProfileConnectionAction`'s
 * block dialog is standalone: a dialog trigger rendered as a menu item
 * fights the menu's own close-on-select behavior. The menu items here
 * only flip this card's own `editOpen`/`deleteOpen` state.
 */
function SpeechCard({ speech }: { speech: Speech }) {
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <Card className="workspace-notebook-surface workspace-notebook-panel workspace-notebook-poster-card">
      <SpeechPoster speech={speech} className="rounded-b-none" />
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
          {speech.title}
          <SupersedesBadge speech={speech} />
        </CardTitle>
        <CardAction>
          <DropdownMenuRoot modal={false}>
            <DropdownMenuTrigger
              render={
                <Button type="button" variant="ghost" size="icon-sm" className="workspace-notebook-control workspace-notebook-control--secondary" aria-label="Speech options">
                  <MoreHorizontal />
                </Button>
              }
            />
            <DropdownMenuPortal>
              <DropdownMenuPositioner align="end">
                <DropdownMenuPopup>
                  <DropdownMenuItem onClick={() => setEditOpen(true)}>Edit details</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDeleteOpen(true)}>Remove speech</DropdownMenuItem>
                </DropdownMenuPopup>
              </DropdownMenuPositioner>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge speech={speech} />
        {speech.primary_video?.status === 'ready' && (
          <Button size="sm" variant="outline" className="workspace-notebook-control workspace-notebook-control--primary" render={<Link to={`/speeches/${speech.id}`} />}>
            Watch
          </Button>
        )}
      </CardContent>

      <SpeechEditDialog speech={speech} open={editOpen} onOpenChange={setEditOpen} />
      <SpeechDeleteDialog speech={speech} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </Card>
  )
}
