import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NoPosterPlaceholder } from '@/components/speech/NoPosterPlaceholder'
import { StatusBadge, SupersedesBadge } from '@/components/speech/StatusBadge'
import { useListSpeechesQuery } from '@/features/speech/speechApi'

/**
 * STEP-03-upload-and-watch.md's "my speeches" — "the card shows
 * `processing`, then `ready`" is a live transition the demo script watches
 * happen, not something that needs a manual page reload. Polls at a fixed
 * interval the whole time this page is mounted; RTK Query starts/stops the
 * poll automatically with the component, so there's nothing to tear down
 * by hand, and a background GET every few seconds is cheap enough not to
 * need the extra complexity of turning it off once everything settles. No
 * posters exist yet (§9.5 is a later step) — every card renders
 * NoPosterPlaceholder, which is the point: a posterless card that reads as
 * intentional, not broken.
 */
export default function MySpeeches() {
  const { data, isLoading } = useListSpeechesQuery(undefined, { pollingInterval: 3000 })

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  const speeches = data?.speeches ?? []

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My speeches</h1>
        <Button render={<Link to="/speeches/new" />}>Upload a speech</Button>
      </div>

      {speeches.length === 0 && (
        <p className="text-sm text-muted-foreground">No speeches yet.</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {speeches.map((speech) => (
          <Card key={speech.id}>
            <NoPosterPlaceholder ulid={speech.ulid} title={speech.title} className="rounded-b-none" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {speech.title}
                <SupersedesBadge speech={speech} />
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <StatusBadge speech={speech} />
              {speech.primary_video?.status === 'ready' && (
                <Button size="sm" variant="outline" render={<Link to={`/speeches/${speech.id}`} />}>
                  Watch
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
