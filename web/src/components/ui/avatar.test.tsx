import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Avatar } from '@/components/ui/avatar'

describe('Avatar', () => {
  it('renders an <img> when a src is given', () => {
    render(<Avatar src="https://example.com/a.jpg" alt="Ada L." />)
    const img = screen.getByRole('img', { name: 'Ada L.' })
    expect(img).toHaveAttribute('src', 'https://example.com/a.jpg')
  })

  it('falls back to a muted placeholder div when src is missing or null', () => {
    const { container, rerender } = render(<Avatar src={null} />)
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument()

    rerender(<Avatar />)
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })

  it('applies the square shape for grid tiles', () => {
    const { container } = render(<Avatar src="https://example.com/a.jpg" shape="square" />)
    expect(container.querySelector('img')).toHaveClass('rounded-md')
    expect(container.querySelector('img')).not.toHaveClass('rounded-full')
  })
})
