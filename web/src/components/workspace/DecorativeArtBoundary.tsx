import { Component } from 'react'
import type { ReactNode } from 'react'

/** Contains drawing failures only; the caller owns the reserved empty frame. */
export class DecorativeArtBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
