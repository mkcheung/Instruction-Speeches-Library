import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HighlightedText } from './HighlightedText'

describe('HighlightedText', () => {
  it('preserves original text and marks only server-designated parts with contrast in both themes', () => {
    const { container } = render(<p><HighlightedText parts={[
      { text: 'Unmarked district ', matched: false }, { text: 'DISTRICT 😀', matched: true },
      { text: ' and punctuation! ', matched: false }, { text: 'district', matched: true },
    ]} /></p>)
    expect(container.textContent).toBe('Unmarked district DISTRICT 😀 and punctuation! district')
    expect(container.querySelectorAll('mark')).toHaveLength(2)
    expect(screen.getByText('DISTRICT 😀')).toHaveClass('bg-yellow-200', 'text-gray-950', 'dark:bg-yellow-200', 'dark:text-gray-950')
  })
  it('keeps potentially dangerous strings literal and handles empty parts', () => {
    const text = '<img src=x onerror=alert(1)> [MATCH] %_\\'
    const { container, rerender } = render(<HighlightedText parts={[{ text, matched: true }]} />)
    expect(container.textContent).toBe(text)
    expect(container.querySelector('img')).toBeNull()
    rerender(<HighlightedText parts={[]} />)
    expect(container.textContent).toBe('')
  })
})
