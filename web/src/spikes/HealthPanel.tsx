import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { API_URL } from '@/lib/api'

type HealthState =
  | { status: 'loading' }
  | { status: 'ok'; body: unknown }
  | { status: 'error'; message: string; body?: unknown }

/**
 * Panel (a): health + credentialed fetch.
 *
 * Calls `${VITE_API_URL}/api/health` with `credentials: 'include'` on mount
 * (proving cookies round-trip across the SPA/API origin split, per the
 * Docker Compose layout in §21) and renders a colored tile plus the raw
 * JSON response.
 */
export default function HealthPanel() {
  const [state, setState] = useState<HealthState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const res = await fetch(`${API_URL}/api/health`, {
          credentials: 'include',
        })
        const contentType = res.headers.get('content-type') ?? ''
        const body = contentType.includes('application/json')
          ? await res.json()
          : await res.text()

        if (cancelled) return

        if (!res.ok) {
          setState({ status: 'error', message: `HTTP ${res.status}`, body })
          return
        }
        setState({ status: 'ok', body })
      } catch (err) {
        if (cancelled) return
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const tileClass =
    state.status === 'ok'
      ? 'bg-[var(--color-success)] text-white'
      : state.status === 'error'
        ? 'bg-[var(--color-danger)] text-white'
        : 'bg-muted text-muted-foreground'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Health + credentialed fetch</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          data-testid="health-tile"
          className={`flex h-16 w-full items-center justify-center rounded-md text-sm font-medium ${tileClass}`}
        >
          {state.status === 'loading' && 'checking…'}
          {state.status === 'ok' && 'API reachable'}
          {state.status === 'error' && `error: ${state.message}`}
        </div>
        <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
          {state.status === 'loading'
            ? 'waiting for response…'
            : JSON.stringify(state.body, null, 2)}
        </pre>
        <p className="text-xs text-muted-foreground">
          GET {API_URL}/api/health (credentials: include)
        </p>
      </CardContent>
    </Card>
  )
}
