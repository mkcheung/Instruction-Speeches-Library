/**
 * §9.5's typographic no-poster placeholder: "the speech's initial on a hue
 * derived from its ULID." Deterministic (same ulid -> same hue always, no
 * randomness, no network) so a posterless card reads as intentional rather
 * than as a loading/broken state that might change on refresh.
 */
export function hueFromId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return hash % 360
}

/** A pleasant, consistent saturation/lightness pair — only the hue varies. */
export const COLOR_SATURATION = 0.55
export const COLOR_LIGHTNESS = 0.45

export function colorFromId(id: string): string {
  return `hsl(${hueFromId(id)}deg ${COLOR_SATURATION * 100}% ${COLOR_LIGHTNESS * 100}%)`
}
