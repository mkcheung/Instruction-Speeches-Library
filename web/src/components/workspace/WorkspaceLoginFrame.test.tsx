import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceLoginFrame } from './WorkspaceLoginFrame'

vi.mock('./ActivityScene', () => ({
  ActivityScene: ({ scene, variant }: { scene: string; variant: string }) => (
    <div aria-hidden="true" data-workspace-scene={scene} data-variant={variant} />
  ),
}))

describe('WorkspaceLoginFrame', () => {
  it('keeps the real form separate from the decorative welcome and marquee', () => {
    const { container } = render(
      <WorkspaceLoginFrame>
        <form><h1>Log in</h1><label>Email<input type="email" /></label><button>Log in</button></form>
      </WorkspaceLoginFrame>,
    )
    expect(container.firstElementChild).toHaveClass('workspace-login')
    const stage = container.querySelector('.workspace-login-stage')!
    const brand = screen.getByText('Instruction Speeches Library')
    expect(stage.firstElementChild).toBe(brand)
    expect(brand).toHaveClass('workspace-login-brand')
    expect(brand.closest('a,button,h1,h2,h3')).toBeNull()
    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument()
    const art = container.querySelector('[data-workspace-scene="welcome"]')!
    expect(art).toHaveAttribute('data-variant', 'login')
    expect(art.parentElement).toHaveClass('workspace-login-welcome')
    const form = screen.getByRole('button', { name: 'Log in' }).closest('form')!
    expect(form.parentElement).toHaveClass('workspace-login-form')
    expect(form.closest('[aria-hidden="true"]')).toBeNull()
    expect(screen.getByLabelText('Email')).toBeEnabled()
    expect(stage.querySelector('.workspace-login-grid')!.children).toHaveLength(2)
  })
})
