import type { BrowserContext } from '@playwright/test'

/** Laravel URL-encodes this cookie; direct API writes need its decoded header. */
export async function xsrfHeaders(
  context: Pick<BrowserContext, 'cookies'>,
  apiUrl: string,
  { required = true, message = 'no XSRF-TOKEN cookie — has the session gone stale?' }: { required?: boolean; message?: string } = {},
): Promise<Record<string, string>> {
  const cookie = (await context.cookies(apiUrl)).find((candidate) => candidate.name === 'XSRF-TOKEN')
  if (!cookie) {
    if (required) throw new Error(message)
    return {}
  }
  return { 'X-XSRF-TOKEN': decodeURIComponent(cookie.value) }
}
