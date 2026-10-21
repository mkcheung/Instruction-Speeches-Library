import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { skipToken } from '@reduxjs/toolkit/query/react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { HighlightedText } from '@/components/search/HighlightedText'
import { useSearchSpeechesQuery } from '@/features/transcript/transcriptApi'
import { PageShell } from '@/components/layout/PageShell'

/** Owner-only literal search; keep the existing debounce and caption-convergence refetch. */
export default function Search() {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const trimmed = query.trim()
  const tooLong = Array.from(trimmed).length > 255

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(handle)
  }, [query])

  const { currentData, isFetching, isError } = useSearchSpeechesQuery(
    trimmed && !tooLong && debounced && Array.from(debounced).length <= 255
      ? { q: debounced }
      : skipToken,
    // A caption edit may replace the projection while this route is unmounted.
    { refetchOnMountOrArgChange: true },
  )
  const isCurrentQuery = Boolean(trimmed) && !tooLong && trimmed === debounced
  const hasError = isCurrentQuery && isError
  const results = isCurrentQuery && !hasError ? currentData ?? [] : []
  const searching = Boolean(trimmed) && !tooLong && (!isCurrentQuery || isFetching)
  let status = ''
  if (!trimmed) status = 'Start typing to search.'
  else if (searching) status = 'Searching…'
  else if (isCurrentQuery && !hasError && currentData !== undefined) {
    status = results.length
      ? `${results.length} ${results.length === 1 ? 'speech' : 'speeches'} matched.`
      : `No speeches matched "${debounced}".`
  }

  return (
    <PageShell width="content">
      <div>
        <h1 className="text-2xl font-semibold">Search your speeches</h1>
        <p className="text-sm text-muted-foreground">
          Search titles, descriptions, and available speech transcripts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
          <CardDescription>Find a speech by a word or phrase.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="speech-search-input">Search text</Label>
            <Input
              id="speech-search-input"
              placeholder="Search your speeches…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-invalid={tooLong || undefined}
              aria-describedby={tooLong ? 'speech-search-length-error' : undefined}
            />
            {tooLong && (
              <p id="speech-search-length-error" role="alert" className="text-sm text-[var(--color-danger)]">
                Enter no more than 255 characters.
              </p>
            )}
          </div>

          {hasError && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              Couldn't search right now. Try again.
            </p>
          )}

          <p role="status" className="text-sm text-muted-foreground">{status}</p>

          {results.length > 0 && (
            <ul className="flex min-w-0 flex-col gap-2">
              {results.map((speech) => {
                const match = speech.search_match
                const excerpt = match?.transcript_excerpt
                return (
                  <li key={speech.id} className="min-w-0 rounded-lg border border-border px-3 py-2 text-sm [overflow-wrap:anywhere]">
                    <Link
                      to={`/speeches/${speech.id}`}
                      className="rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {match ? <HighlightedText parts={match.title} /> : speech.title}
                    </Link>
                    {speech.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {match?.description
                          ? <HighlightedText parts={match.description} />
                          : speech.description}
                      </p>
                    )}
                    {excerpt && (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-muted-foreground">Transcript excerpt</p>
                        <p>
                          {excerpt.truncated_before && '…'}
                          <HighlightedText parts={excerpt.parts} />
                          {excerpt.truncated_after && '…'}
                        </p>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}
