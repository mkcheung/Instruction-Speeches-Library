import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FriendPersonAvatar } from './FriendPersonAvatar'

describe('FriendPersonAvatar', () => {
  it('reserves an image shape, lazy loads and avoids repeating the adjacent name', () => {
    const { container } = render(<FriendPersonAvatar src="/signed-a.jpg" />)
    const image = container.querySelector('img')!
    expect(image).toHaveAttribute('width', '72')
    expect(image).toHaveAttribute('height', '72')
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('alt', '')
  })
  it('falls back for missing/failed URLs and retries when a different URL arrives', () => {
    const { container, rerender } = render(<FriendPersonAvatar src={null} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
    rerender(<FriendPersonAvatar src="/signed-a.jpg" />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    rerender(<FriendPersonAvatar src="/signed-b.jpg" />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/signed-b.jpg')
    rerender(<FriendPersonAvatar src="/signed-a.jpg" />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/signed-a.jpg')
  })
})
