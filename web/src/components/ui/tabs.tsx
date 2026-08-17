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
        'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors',
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
