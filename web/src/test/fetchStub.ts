/** Helpers for tests that replace `fetch` with a stub. fetchBaseQuery calls `fetch(request)` with a pre-built
 * Request; direct calls pass `(url, init)`. */

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

export function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (input instanceof Request ? input.method : (init?.method ?? 'GET')).toUpperCase()
}

/** A Request's JSON body, or `{}` when there is none or it isn't JSON. */
export async function bodyOf(input: RequestInfo | URL): Promise<Record<string, unknown>> {
  if (!(input instanceof Request)) return {}
  try {
    return (await input.clone().json()) as Record<string, unknown>
  } catch {
    return {}
  }
}
