/** Base URL for the Laravel API. Defaults to the local dev host. */
export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'
