import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import Account from '@/routes/Account'

/**
 * §7.8: the Storage card's used/quota text. The other two cards'
 * underlying hooks/mutations (`useExportJob`, `useGetExportsQuery` via
 * `ExportSection`, `useDeleteAccountMutation` via `DeleteAccountDialog`)
 * are mocked away — this file isn't about them, matching
 * `AnnotationComposerPanel.test.tsx`'s pattern of stubbing unrelated
 * sibling components to isolate the behavior under test.
 */
vi.mock('@/features/auth/authApi', () => ({
  useGetMeQuery: () => ({ data: { user: { roles: [], storage_bytes_used: 3 * 1024 ** 3, quota_bytes: 5 * 1024 ** 3 } } }),
}))
vi.mock('@/hooks/useExportJob', () => ({
  useExportJob: () => ({ exports: [], isFetching: false, refetch: vi.fn() }),
  latestExportOfKind: () => undefined,
}))
vi.mock('@/components/account/ExportSection', () => ({ ExportSection: () => null }))
vi.mock('@/components/account/DeleteAccountDialog', () => ({ DeleteAccountDialog: () => null }))

describe('Account', () => {
  it('renders the storage section with the used/quota text from /api/me', () => {
    render(<MemoryRouter initialEntries={['/account']}><Account /></MemoryRouter>)
    expect(screen.getByText('Storage')).toBeInTheDocument()
    expect(screen.getByText('3.0 GiB of 5.0 GiB used')).toBeInTheDocument()
  })
})
