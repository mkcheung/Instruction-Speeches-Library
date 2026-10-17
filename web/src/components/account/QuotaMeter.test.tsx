import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuotaMeter } from '@/components/account/QuotaMeter'

describe('QuotaMeter', () => {
  it('renders the used/quota text', () => {
    render(<QuotaMeter usedBytes={1024} quotaBytes={2048} />)
    expect(screen.getByText('1.0 KiB of 2.0 KiB used')).toBeInTheDocument()
  })

  /**
   * code-review finding: a zero quota used to render an empty 0% bar —
   * indistinguishable from "nothing used yet" when it actually means "fully
   * blocked." A fully-exhausted meter is what the user should see instead.
   */
  it('renders a full bar, not an empty one, when quotaBytes is 0', () => {
    render(<QuotaMeter usedBytes={0} quotaBytes={0} />)
    expect(screen.getByRole('progressbar', { name: 'Storage used' })).toHaveAttribute('aria-valuenow', '100')
  })
})
