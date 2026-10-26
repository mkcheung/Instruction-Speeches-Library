/** Build a profile route from raw, unencoded path segments; search/hash belong to the caller. */
export function profilePath(username: string, ...segments: string[]): string {
  return `/u/${[username, ...segments].map((segment) => encodeURIComponent(segment)).join('/')}`
}
