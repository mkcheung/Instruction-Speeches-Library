/**
 * D3 (PLAN-APP-HEADER.md) — closed-form initials-chip contrast, no
 * lightness clamp needed. `colorFromId` fixes saturation/lightness at
 * `55%`/`45%` and only varies hue, so a single fixed foreground colour
 * (e.g. always white) fails WCAG 2.2 AA 4.5:1 at roughly half the hue
 * circle (`hsl(60 55% 45%)`, the yellow, is 2.26:1 against white).
 *
 * The fix picks the foreground per-background rather than per-hue:
 * compute the background's relative luminance, then return whichever of
 * black or white has the higher contrast ratio against it. The two
 * "passes at 4.5:1" ranges — white passes when `Lbg <= 0.1833`, black
 * passes when `Lbg >= 0.175` — overlap and jointly cover all of `[0,1]`,
 * so "pick the higher-contrast one" is provably >=4.5:1 everywhere, worst
 * case ~4.58:1 right at the crossover. See the contract for the derivation.
 */

interface HslColor {
  h: number
  s: number
  l: number
}

/** WCAG relative luminance from sRGB channels in `[0,1]`. */
function relativeLuminance(r: number, g: number, b: number): number {
  const linearize = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
  const [rl, gl, bl] = [linearize(r), linearize(g), linearize(b)]
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
}

/** HSL (degrees, 0-1, 0-1) -> sRGB channels in `[0,1]`. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = ((h % 360) + 360) % 360 / 60
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

function contrastRatio(l1: number, l2: number): number {
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (lighter + 0.05) / (darker + 0.05)
}

/** Given the `colorFromId` HSL background (`s` and `l` in `[0,1]`, `h` in
 * degrees), return whichever of black/white passes 4.5:1 with the higher
 * margin. Deterministic and pure — no clamping of the input required. */
export function foregroundFor({ h, s, l }: HslColor): '#000000' | '#ffffff' {
  const [r, g, b] = hslToRgb(h, s, l)
  const bgLuminance = relativeLuminance(r, g, b)

  const whiteContrast = contrastRatio(1, bgLuminance)
  const blackContrast = contrastRatio(0, bgLuminance)

  return whiteContrast >= blackContrast ? '#ffffff' : '#000000'
}
