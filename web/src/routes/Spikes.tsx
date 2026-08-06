import { useState } from 'react'
import { isSpikesEnabled } from '@/lib/spikes-guard'
import HealthPanel from '@/spikes/HealthPanel'
import VideoPanel from '@/spikes/VideoPanel'
import CueTimingPanel from '@/spikes/CueTimingPanel'
import NotFound from './NotFound'

/**
 * `/__spikes` — dev-only spike wall (STEP-00).
 *
 * This is the SECOND half of the double env guard: even if this component
 * were ever reachable via a misconfigured route table, it independently
 * refuses to render and bails to the same NotFound page the route table
 * itself falls back to when the guard fails. There is no code path that
 * renders spike content unless BOTH `import.meta.env.DEV` and
 * `VITE_ENABLE_SPIKES=true` hold.
 */
export default function Spikes() {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)

  if (!isSpikesEnabled()) {
    // Render the 404-equivalent in place — no redirect, no 403. The route
    // simply does not exist when either guard fails.
    return <NotFound />
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-medium">Spike wall</h1>
        <p className="text-sm text-muted-foreground">
          Dev-only. Gated behind DEV + VITE_ENABLE_SPIKES.
        </p>
      </header>

      <HealthPanel />
      <VideoPanel onVideoElement={setVideo} />
      <CueTimingPanel video={video} />
    </main>
  )
}

export { NotFound }
