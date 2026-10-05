import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The single page-width primitive for every authenticated route.
 *
 * Before this existed, each route hand-rolled
 * `mx-auto flex max-w-{sm..5xl} flex-col gap-N px-4 py-10`, which produced
 * three compounding problems on a large window:
 *
 * 1. **Caps far below the available width.** `max-w-3xl` is 48rem. On a
 *    1920px window with the 14rem sidebar there are ~106rem of usable
 *    space, so an index page used under half of it and a form page
 *    (`max-w-xl`, 36rem) under a third.
 * 2. **Centred inside `<main>`, not the window.** `mx-auto` centres within
 *    the area *after* the sidebar, so the content island sits right of
 *    true centre and reads as detached from the nav it belongs to. Every
 *    page therefore looked off-balance rather than merely narrow.
 * 3. **Vertically centred forms.** `flex-1 … justify-center` floated short
 *    forms in the middle of a tall `<main>`, leaving a large dead band
 *    under the header and no stable position for the first field as the
 *    form grew or shrank.
 *
 * `PageShell` fixes all three by being **left-aligned** (no `mx-auto`):
 * content flows from the sidebar with a consistent gutter and grows into
 * the window up to a per-variant ceiling, the way a sidebar app is
 * normally laid out. Gutters and vertical rhythm scale with the viewport
 * instead of being pinned at `px-4`.
 *
 * Pick `width` by content type, not by page:
 * - `form`    — anything with a single column of inputs or prose. Capped
 *               at a readable measure; widening a form does not help
 *               anyone fill it in.
 * - `content` — lists and detail views that are mostly text.
 * - `wide`    — card grids, tables, media. These genuinely benefit from
 *               every pixel, so the ceiling is high enough to be a no-op
 *               below ~1700px.
 * - `full`    — no ceiling at all; the page manages its own width.
 */
export type PageWidth = 'form' | 'content' | 'wide' | 'full'

const WIDTH_CLASS: Record<PageWidth, string> = {
  form: 'max-w-2xl',
  content: 'max-w-5xl',
  wide: 'max-w-[100rem]',
  full: 'max-w-none',
}

export function PageShell({
  width = 'content',
  className,
  children,
}: {
  width?: PageWidth
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        // `w-full` + a max, never a fixed width, so every size between the
        // breakpoints is laid out too — the brief's "reconfigure when the
        // window changes," not three hard-coded layouts.
        'flex w-full flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10',
        WIDTH_CLASS[width],
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * Page title plus optional trailing actions. `flex-wrap` rather than a
 * grid: at narrow widths the actions drop under the heading instead of
 * squeezing it, which is what keeps a long title readable on a phone.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/**
 * A responsive card grid that reflows by *available width* rather than by
 * viewport breakpoints. `auto-fill` + `minmax` means the column count is
 * derived from the container, so it stays correct inside the sidebar
 * layout at every width — including the sizes between breakpoints, where a
 * `sm:grid-cols-2 lg:grid-cols-3` ladder would leave a half-empty row.
 *
 * `minmax(min(100%, 16rem), 1fr)` and not `minmax(16rem, 1fr)`: below
 * 16rem of available space the bare form overflows its container instead
 * of collapsing to one column, which is exactly the 320px-phone case.
 */
export function CardGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr))]',
        className,
      )}
    >
      {children}
    </div>
  )
}
