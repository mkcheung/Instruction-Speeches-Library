import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const waveform = vi.hoisted(() => ({ destroy: vi.fn() }))
const createWaveform = vi.hoisted(() => vi.fn(() => waveform))
vi.mock('wavesurfer.js', () => ({ default: { create: createWaveform } }))

import { VoiceWaveformPreview } from '@/components/annotation/VoiceWaveformPreview'

describe('VoiceWaveformPreview', () => {
  beforeEach(() => {
    waveform.destroy.mockClear()
    createWaveform.mockClear()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => `blob:voice-${blob.size}`),
      revokeObjectURL: vi.fn(),
    })
  })

  it('uses only a local blob URL and destroys/revokes it on replacement and unmount', () => {
    const first = new Blob(['one'], { type: 'audio/webm' })
    const rendered = render(<VoiceWaveformPreview blob={first} />)
    expect(createWaveform).toHaveBeenCalledWith(expect.objectContaining({ url: 'blob:voice-3' }))
    expect(screen.getByLabelText('Preview voice note')).toHaveAttribute('src', 'blob:voice-3')

    rendered.rerender(<VoiceWaveformPreview blob={new Blob(['second'], { type: 'audio/webm' })} />)
    expect(waveform.destroy).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice-3')
    rendered.unmount()
    expect(waveform.destroy).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice-6')
  })
})
