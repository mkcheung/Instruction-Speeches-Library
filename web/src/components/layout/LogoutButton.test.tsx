import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DropdownMenuRoot, DropdownMenuPortal, DropdownMenuPositioner, DropdownMenuPopup } from '@/components/ui/dropdown-menu'
import { LogoutMenuItem } from '@/components/layout/LogoutButton'
import { authSessionActions } from '@/features/auth/authSession'
import { hardNavigation } from '@/lib/hardNavigation'
import { renderWithProviders } from '@/test/renderWithProviders'

afterEach(() => vi.unstubAllGlobals())

function mount() {
  return renderWithProviders(
    <DropdownMenuRoot open><DropdownMenuPortal><DropdownMenuPositioner><DropdownMenuPopup><LogoutMenuItem /></DropdownMenuPopup></DropdownMenuPositioner></DropdownMenuPortal></DropdownMenuRoot>,
  )
}

describe('LogoutMenuItem', () => {
  it('hard-navigates to /login after a successful logout', async () => {
    const assign = vi.spyOn(hardNavigation, 'assign').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    document.cookie = 'XSRF-TOKEN=t; path=/'
    mount()
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'Log out' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'))
    assign.mockRestore()
  })

  it('does not hard-navigate when a newer auth attempt superseded this logout', async () => {
    const assign = vi.spyOn(hardNavigation, 'assign').mockImplementation(() => {})
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.stubGlobal('fetch', vi.fn(async () => { await gate; return new Response(null, { status: 204 }) }))
    document.cookie = 'XSRF-TOKEN=t; path=/'
    const { store } = mount()
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'Log out' }))
    await screen.findByText('Signing out…')
    act(() => { store.dispatch(authSessionActions.attemptStarted('newer-attempt')) })
    release()
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument())
    expect(assign).not.toHaveBeenCalled()
    assign.mockRestore()
  })
})
