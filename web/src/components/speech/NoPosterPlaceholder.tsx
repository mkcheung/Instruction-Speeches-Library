import { colorFromId } from '@/lib/colorFromId'
import { cn } from '@/lib/utils'

/**
 * §9.5: "No poster is a designed state, not a broken image" — a 16:9 box
 * with the speech's initial on a hue derived from its ULID. Zero requests,
 * zero CLS. STEP-03 never has real posters yet (that's §9.5/S4), so this is
 * what every speech card shows today, not a fallback for a rare case.
 */
export function NoPosterPlaceholder({ ulid, title, className }: { ulid: string; title: string; className?: string }) {
  const initial = title.trim().charAt(0).toUpperCase() || '?'

  return (
    <div
      className={cn('flex aspect-video items-center justify-center rounded-md text-3xl font-semibold text-white', className)}
      style={{ backgroundColor: colorFromId(ulid) }}
      aria-hidden="true"
    >
      {initial}
    </div>
  )
}
