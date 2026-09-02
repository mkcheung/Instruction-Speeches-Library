/** "Mar 2026" — the profile identity block's "Connected since Mar 2026"
 * line, and the fallback text `connectionMetricLine` below uses when a
 * rail row somehow arrives with no `metric` (shouldn't happen against the
 * real backend, but keeps the tile from rendering blank). */
export function formatMonthYear(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date(iso))
}

/**
 * MODERNIZATION_PLAN.md §6.7.4's connection-tile metric line — one of
 * five exact strings ("N reviews together" / "You reviewed N" /
 * "Reviewed N of yours" / "Connected {Month Year}" / "Wants to
 * connect"). `ConnectionController::index` (the real backend, reconciled
 * after this slice was first written against a guess) computes this
 * server-side in ONE aggregate query for the whole rail page (R19) and
 * sends it as `connection.metric` already rendered — this helper is
 * deliberately NOT a client-side re-derivation of the five-case table
 * (an earlier version of this file was; STEP-13-social-layer.md's own
 * "check what connectionApi.ts's response actually contains... don't
 * guess" applies here exactly). It only supplies the one fallback the
 * precomputed field can't cover.
 */
export function connectionMetricLine(connection: { metric?: string; connected_at: string | null }): string {
  if (connection.metric) return connection.metric
  return connection.connected_at ? `Connected ${formatMonthYear(connection.connected_at)}` : 'Connected'
}
