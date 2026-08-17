import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { skipToken } from '@reduxjs/toolkit/query/react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSearchSpeechesQuery } from '@/features/transcript/transcriptApi'

/**
 * STEP-09-FROZEN-CONTRACT.md §5: "Search is a new top-level route,
 * `/search`... it queries across all of a user's own speeches, not one
 * speech." STEP-09-captions.md's demo script: "Search your speeches for a
 * phrase you said. The right speech comes back."
 *
 * 300ms debounce, matching `ReviewerDirectory.tsx`'s own search input —
 * same interaction shape, reused rather than invented fresh. `skipToken`
 * (not `skip: true`) so an empty query never even issues the request,
 * same idiom `EssayReadOnlyPanel.tsx` uses for its own conditional query.
 */
export default function Search() {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(handle)
  }, [query])

  const { data, isFetching, isError } = useSearchSpeechesQuery(debounced ? { q: debounced } : skipToken)
  const results = data ?? []

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">Search your speeches</h1>
        <p className="text-sm text-muted-foreground">
          Find a speech by something you said in it — searches every transcript, not just titles.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
          <CardDescription>Which of my speeches mentioned this?</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="speech-search-input">Phrase</Label>
            <Input
              id="speech-search-input"
              placeholder="Search your speeches…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {isError && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              Couldn't search right now. Try again.
            </p>
          )}

          {!isError && debounced && isFetching && (
            <p className="text-sm text-muted-foreground">Searching…</p>
          )}

          {!isError && debounced && !isFetching && results.length === 0 && (
            <p className="text-sm text-muted-foreground">No speeches matched "{debounced}".</p>
          )}

          {!debounced && <p className="text-sm text-muted-foreground">Start typing to search.</p>}

          {results.length > 0 && (
            <ul className="flex flex-col gap-2">
              {results.map((speech) => (
                <li key={speech.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                  <Link to={`/speeches/${speech.id}`} className="font-medium hover:underline">
                    {speech.title}
                  </Link>
                  {speech.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{speech.description}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
