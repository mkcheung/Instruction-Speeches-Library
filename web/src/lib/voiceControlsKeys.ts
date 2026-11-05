import type { KeyboardEvent } from 'react'

/** Keys inside the floating voice controls: Escape skips the note; nothing leaks to the player. */
export function handleVoiceControlsKeyDown(event: KeyboardEvent, skip: () => void): void {
  if (event.key === 'Escape') skip()
  event.stopPropagation()
}
