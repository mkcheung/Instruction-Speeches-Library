import { useEffect, useState } from 'react'
import { useSearchReviewersQuery } from './reviewApi'

type CredentialFilter = '' | 'member' | 'coach'

/** Shared directory mechanics; invitation selection and form state stay with their caller. */
export function useReviewerDirectory() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [credential, setCredential] = useState<CredentialFilter>('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(handle)
  }, [search])

  // Reset synchronously so a changed filter never asks for the previous page first.
  const changeSearch = (next: string) => { setSearch(next); setPage(1) }
  const changeCredential = (next: CredentialFilter) => { setCredential(next); setPage(1) }
  const query = useSearchReviewersQuery({
    search: debouncedSearch || undefined,
    credential: credential || undefined,
    page,
  })

  return { search, credential, page, changeSearch, changeCredential, setPage, query }
}
