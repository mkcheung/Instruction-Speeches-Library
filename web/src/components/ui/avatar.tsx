import { cn } from '@/lib/utils'

/**
 * STEP-13-FROZEN-CONTRACT.md §9: extracted out of `PublicProfile.tsx`'s
 * inline `<img>` + fallback-`<div>` pattern (confirmed missing as a shared
 * component anywhere in this codebase — `ReviewerDirectory.tsx` and
 * `InviteReviewerDialog.tsx` both render reviewers with no avatar at all).
 * Every place an avatar renders from STEP-13 forward should use this
 * instead of hand-rolling the fallback again.
 */
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZE_CLASSES: Record<AvatarSize, string> = {
  // 32px — connections-rail tiles, compact lists
  xs: 'size-8',
  // 40px — inline mentions, menu rows
  sm: 'size-10',
  // 64px — directory/list rows
  md: 'size-16',
  // 112px — the original `PublicProfile.tsx` card size
  lg: 'size-28',
  // 160px — the profile identity block, roughly the reference
  // screenshot's ~168px cover-overlapping avatar (§6.7.4's mockup)
  xl: 'size-40',
}

export interface AvatarProps {
  src?: string | null
  /** Empty by default (matching the original inline pattern) — the name
   * sitting right next to every avatar in this app already announces who
   * it is, so a repeated accessible name would be redundant. Pass an
   * explicit `alt` only where the avatar has no adjacent text label. */
  alt?: string
  size?: AvatarSize
  /** Facebook's friends-grid tiles are square (§6.7.4's 3-up 1:1 grid);
   * every other avatar in this app is a circle. */
  shape?: 'circle' | 'square'
  className?: string
}

export function Avatar({ src, alt = '', size = 'md', shape = 'circle', className }: AvatarProps) {
  const sizeClass = SIZE_CLASSES[size]
  const shapeClass = shape === 'circle' ? 'rounded-full' : 'rounded-md'

  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        className={cn(sizeClass, shapeClass, 'object-cover ring-1 ring-foreground/10', className)}
      />
    )
  }

  return <div className={cn(sizeClass, shapeClass, 'bg-muted', className)} aria-hidden="true" />
}
