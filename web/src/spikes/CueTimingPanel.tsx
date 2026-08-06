import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CueSpec } from '@/lib/engine'
import { useCueLatencyDrivers } from '@/hooks/useCueLatencyDrivers'

/** Fixture data — unstyled, unpersisted, per STEP-00's "deliberately stubbed". */
const FIXTURE_CUES: CueSpec[] = [
  { id: 'cue-1', startSeconds: 2, durationSeconds: 3 },
  { id: 'cue-2', startSeconds: 6, durationSeconds: 4 },
  { id: 'cue-3', startSeconds: 11, durationSeconds: 2.5 },
]

interface CueTimingPanelProps {
  video: HTMLVideoElement | null
}

/**
 * Panel (c): the cue-timing engine, driven live over the video from panel
 * (b). `normalize` / `computeActive` / `timingSignature` are unit-tested in
 * `src/lib/engine.test.ts` (run via `npm run test`); this panel exercises
 * the DOM-facing half — three independent timing drivers instrumented to
 * report cue-boundary latency, per §8.2 and STEP-00's acceptance criteria.
 *
 * This table is only meaningful once a human plays a real video file
 * (placed in SeaweedFS by hand) in a real browser — Chrome AND Safari, per
 * the acceptance criteria — and presses play/scrubs. Nothing in this
 * environment can produce real numbers: there is no browser runtime here
 * and no video file has been uploaded yet.
 */
export default function CueTimingPanel({ video }: CueTimingPanelProps) {
  const cues = FIXTURE_CUES
  const { rows, running, start, stop, rvfcSupported } = useCueLatencyDrivers(
    video,
    cues,
  )

  const byDriver = useMemo(() => {
    const groups: Record<string, number[]> = {
      texttrack: [],
      rvfc: [],
      timeupdate: [],
    }
    for (const r of rows) groups[r.driver].push(r.latencyMs)
    return groups
  }, [rows])

  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cue-timing engine</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Fixture cues: {cues.map((c) => `${c.id}@${c.startSeconds}s`).join(', ')}
        </p>

        <div className="flex items-center gap-2">
          <Button type="button" onClick={start} disabled={!video || running}>
            Start measuring
          </Button>
          <Button type="button" variant="outline" onClick={stop} disabled={!running}>
            Stop
          </Button>
          {!video && (
            <span className="text-xs text-muted-foreground">
              Load a presigned video in the panel above first.
            </span>
          )}
        </div>

        {!rvfcSupported && (
          <p className="text-xs text-[var(--color-danger)]">
            requestVideoFrameCallback is not supported in this browser — the
            `rvfc` driver will report no rows here.
          </p>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Driver</TableHead>
              <TableHead>Samples</TableHead>
              <TableHead>Avg latency (ms)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(['texttrack', 'rvfc', 'timeupdate'] as const).map((driver) => (
              <TableRow key={driver}>
                <TableCell>{driver}</TableCell>
                <TableCell>{byDriver[driver].length}</TableCell>
                <TableCell>
                  {avg(byDriver[driver]) === null
                    ? '—'
                    : avg(byDriver[driver])!.toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {rows.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary>Raw per-cue samples ({rows.length})</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-md border bg-muted/40 p-3">
              {JSON.stringify(rows, null, 2)}
            </pre>
          </details>
        )}

        <p className="text-xs text-muted-foreground">
          Requires a human: play the video, let it run past all three cue
          starts (or scrub across them), in Chrome AND Safari, then commit
          the resulting table per STEP-00's acceptance criteria.
        </p>
      </CardContent>
    </Card>
  )
}
