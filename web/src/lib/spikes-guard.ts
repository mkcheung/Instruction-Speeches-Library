/**
 * The double env guard §19 specifies: dev-only AND an explicit opt-in flag.
 * Used BOTH to decide whether to register the `/__spikes` route at all, AND
 * at render time inside the route's own component — so there is no path to
 * see it in production even if someone force-navigates or the route table
 * is ever wired up unconditionally by mistake.
 *
 * Failing either guard is a 404, never a 403 — the route does not exist,
 * it isn't merely forbidden.
 */
export function isSpikesEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_ENABLE_SPIKES === 'true'
}
