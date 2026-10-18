import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cn } from '@/lib/utils'

/**
 * Thin wrapper around `@base-ui/react`'s `Tabs` primitive — matching this
 * codebase's established pattern (`button.tsx`, `card.tsx`, `toast.tsx`)
 * of styling base-ui primitives rather than hand-rolling one. `@base-ui
 * /react` already ships this module as a dependency (`web/package.json`),
 * unused until STEP-08's `Notes | Essay` tab strip
 * (STEP-08-FROZEN-CONTRACT.md: "the editor below the player in a tab
 * strip").
 */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-3', className)} {...props} />
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-1', className)}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        // Scoped override, not the global `--muted-foreground` token:
        // axe measured the token's resolved color at 4.34:1 against this
        // tab strip's `bg-muted` background (needs 4.5:1) — a near-miss
        // real-rendering contrast finding (accessibility-baseline/2026-10-
        // 17-baseline-summary.md). `--muted-foreground` backs many other
        // surfaces across the app that weren't flagged, so darkening it
        // globally risks regressions nothing here would catch. `text-
        // neutral-600` (measured ~7:1 against this background) only
        // darkens the inactive-tab-label state; dark mode keeps the
        // original token, which wasn't measured/flagged here.
        'rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 dark:text-muted-foreground transition-colors',
        'hover:text-foreground',
        'data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn('outline-none focus-visible:ring-3 focus-visible:ring-ring/50', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTab, TabsPanel }
