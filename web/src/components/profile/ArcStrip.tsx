import type { ArcChainEntry } from '@/features/connection/types'
import { cn } from '@/lib/utils'

/**
 * §6.11 / STEP-13-social-layer.md demo step 8: "If a speech supersedes an
 * earlier one, an arc strip shows the version history." Data arrives
 * embedded on the timeline card itself (`SpeechArcService::chainFor`,
 * called once per row server-side, no separate per-speech fetch).
 *
 * Reconciled against the real backend: `chain` is ordered `depth` 1..N,
 * where depth 1 is always the speech THIS review is actually about and
 * higher depth is an older ancestor (`supersedes_id` walked backward) —
 * displayed oldest-first here, so reverse the depth order. An entry with
 * `visible: false` means the viewer holds no grant on that version — its
 * title/date are already stripped server-side, so this renders a plain
 * "Earlier version" chip rather than any content, matching §6.11's "being
 * shown that v2 exists never makes v2 playable."
 */
export function ArcStrip({ chain }: { chain: ArcChainEntry[] }) {
  if (chain.length < 2) return null

  const oldestFirst = [...chain].sort((a, b) => b.depth - a.depth)

  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" aria-label="Version history">
      {oldestFirst.map((entry, index) => (
        <li key={entry.id} className="flex items-center gap-1.5">
          {index > 0 && <span aria-hidden="true">→</span>}
          <span
            className={cn(
              'rounded-full border px-2 py-0.5',
              entry.depth === 1
                ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                : 'border-border bg-muted/50',
            )}
          >
            {entry.visible ? (
              <>
                v{oldestFirst.length - index}
                {entry.delivered_on ? ` · ${entry.delivered_on}` : ''}
              </>
            ) : (
              'Earlier version'
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}
