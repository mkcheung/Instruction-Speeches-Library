import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { EssayToolbar } from './EssayToolbar'

describe('EssayToolbar accessible command names', () => {
  it.each([
    { visible: 'H2', name: 'H2: Heading 2', command: 'toggleHeading', argument: { level: 2 } },
    { visible: 'H3', name: 'H3: Heading 3', command: 'toggleHeading', argument: { level: 3 } },
    { visible: '1. list', name: '1. list: Ordered list', command: 'toggleOrderedList', argument: undefined },
  ])('includes $visible in the accessible name and retains its formatting command', ({ visible, name, command, argument }) => {
    const run = vi.fn()
    const toggle = vi.fn(() => ({ run }))
    const focus = vi.fn(() => ({ [command]: toggle }))
    const editor = { isActive: () => false, getAttributes: () => ({}), chain: () => ({ focus }) } as unknown as Editor
    render(<EssayToolbar editor={editor} />)
    const button = screen.getByRole('button', { name })
    expect(button).toHaveTextContent(visible)
    expect(button).toHaveAccessibleName(expect.stringContaining(visible))
    fireEvent.click(button)
    expect(focus).toHaveBeenCalledOnce()
    if (argument) expect(toggle).toHaveBeenCalledWith(argument)
    else expect(toggle).toHaveBeenCalledWith()
    expect(run).toHaveBeenCalledOnce()
  })
})
