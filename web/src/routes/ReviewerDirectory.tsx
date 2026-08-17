import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useSearchReviewersQuery } from '@/features/review/reviewApi'
import { getErrorStatus } from '@/lib/errorStatus'

/**
 * S2/S4 (PLAN-APP-HEADER.md) — surfaces §6.3's reviewer directory as its
 * own destination. The directory itself was already fully built
 * (`reviewApi.ts`'s `searchReviewers`) but reachable only mid-invite-flow,
 * inside `InviteReviewerDialog` — "a built feature currently unreachable
 * except mid-invite-flow." This page reuses that same query rather than
 * a new endpoint; no backend change needed on this side (the contract's
 * server-side `viewDirectory` wiring is what actually gates who may load
 * this page's data — S6: the sidebar hiding this route for admins is an
 * affordance, never the enforcement).
 */
export default function ReviewerDirectory() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [credential, setCredential] = useState<'' | 'member' | 'coach'>('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(handle)
  }, [search])

  const changeSearch = (next: string) => {
    setSearch(next)
    setPage(1)
  }

  const changeCredential = (next: '' | 'member' | 'coach') => {
    setCredential(next)
    setPage(1)
  }

  const { data, isLoading, isError, error } = useSearchReviewersQuery({
    search: debouncedSearch || undefined,
    credential: credential || undefined,
    page,
  })

  const reviewers = data?.reviewers ?? []
  const lastPage = data?.meta.last_page ?? 1
  const total = data?.meta.total ?? 0

  const status = isError ? getErrorStatus(error) : undefined
  const forbidden = status === 403
  // Any other error (500, network failure, ...) must not look like a
  // genuinely empty directory — S6 only requires the *visibility* gate to
  // be honest, but "the request failed" and "nobody matched" are different
  // facts and a silent "No reviewers found." would hide the former.
  const failed = isError && !forbidden

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">Find reviewers</h1>
        <p className="text-sm text-muted-foreground">
          Browse everyone who can review a speech — no open pool, this is the only way to find them.
        </p>
      </div>

      {forbidden ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            The reviewer directory isn't available to this account.
          </CardContent>
        </Card>
      ) : failed ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive" role="alert">
            Couldn't load the reviewer directory — try again.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Reviewers</CardTitle>
            <CardDescription>{total} {total === 1 ? 'reviewer' : 'reviewers'}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reviewer-directory-search">Search by name or username</Label>
              <Input
                id="reviewer-directory-search"
                placeholder="Search…"
                value={search}
                onChange={(event) => changeSearch(event.target.value)}
              />
            </div>

            <div className="flex items-center gap-2" role="group" aria-label="Filter by credential">
              {(['', 'member', 'coach'] as const).map((option) => (
                <Button
                  key={option || 'all'}
                  type="button"
                  size="sm"
                  variant={credential === option ? 'default' : 'outline'}
                  aria-pressed={credential === option}
                  onClick={() => changeCredential(option)}
                >
                  {option === '' ? 'All' : option === 'coach' ? 'Coaches' : 'Members'}
                </Button>
              ))}
            </div>

            {isLoading && <p className="text-sm text-muted-foreground">Searching…</p>}
            {!isLoading && reviewers.length === 0 && (
              <p className="text-sm text-muted-foreground">No reviewers found.</p>
            )}

            <ul className="flex flex-col gap-2">
              {reviewers.map((reviewer) => (
                <li
                  key={reviewer.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{reviewer.name}</span>
                    <span className="text-xs text-muted-foreground">@{reviewer.username}</span>
                  </span>
                  <Badge variant={reviewer.credential === 'coach' ? 'default' : 'secondary'}>
                    {reviewer.credential === 'coach' ? 'Coach' : 'Member'}
                  </Badge>
                </li>
              ))}
            </ul>

            {lastPage > 1 && (
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || isLoading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <span aria-live="polite" className="text-xs text-muted-foreground">
                  Page {page} of {lastPage}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page >= lastPage || isLoading}
                  onClick={() => setPage((current) => Math.min(lastPage, current + 1))}
                >
                  Next
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
