import { describe, expect, it } from 'vitest'
import { foregroundFor } from '@/lib/initialsContrast'

/** Mirrors the WCAG relative-luminance math the module itself uses, kept
 * independent here so the test isn't just re-running the implementation. */
function relativeLuminance(r: number, g: number, b: number): number {
  const linearize = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r1: number, g1: number, b1: number
  if (hp < 1) [r1, g1, b1] = [c, x, 0]
  else if (hp < 2) [r1, g1, b1] = [x, c, 0]
  else if (hp < 3) [r1, g1, b1] = [0, c, x]
  else if (hp < 4) [r1, g1, b1] = [0, x, c]
  else if (hp < 5) [r1, g1, b1] = [x, 0, c]
  else [r1, g1, b1] = [c, 0, x]
  const m = l - c / 2
  return [r1 + m, g1 + m, b1 + m]
}

function contrastAgainstForeground(hue: number, foreground: '#000000' | '#ffffff'): number {
  const [r, g, b] = hslToRgb(hue, 0.55, 0.45)
  const bgLuminance = relativeLuminance(r, g, b)
  const fgLuminance = foreground === '#ffffff' ? 1 : 0
  const [lighter, darker] =
    fgLuminance >= bgLuminance ? [fgLuminance, bgLuminance] : [bgLuminance, fgLuminance]
  return (lighter + 0.05) / (darker + 0.05)
}

describe('foregroundFor', () => {
  it('is >=4.5:1 at every one of the 360 hues colorFromId can produce', () => {
    for (let hue = 0; hue < 360; hue++) {
      const foreground = foregroundFor({ h: hue, s: 0.55, l: 0.45 })
      const ratio = contrastAgainstForeground(hue, foreground)
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('picks white for the known-worst yellow case', () => {
    // hsl(60 55% 45%) is 2.26:1 against white per the plan's own numbers —
    // black must win there.
    expect(foregroundFor({ h: 60, s: 0.55, l: 0.45 })).toBe('#000000')
  })

  it('is deterministic', () => {
    expect(foregroundFor({ h: 200, s: 0.55, l: 0.45 })).toBe(foregroundFor({ h: 200, s: 0.55, l: 0.45 }))
  })
})
