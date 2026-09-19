import * as React from 'react'
import { cn } from 'cn'
import { Tabs as TabsPrimitive } from 'radix-ui'

/**
 * Tabs (DS-011): `07` sección 2.3 — "subrayado teal 2 px, texto 12.5 px"
 * (`.tabs`/`.tab`/`.tab.on`, `Mockup/assets/ds2.css`). El mockup solo tiene
 * esta variante con subrayado (la variante "píldora" de shadcn no hace
 * falta: ese lugar ya lo cubre `SegmentedControl`, DS-005), así que se
 * simplifica el componente a una sola apariencia.
 */
function Tabs({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      orientation={orientation}
      className={cn(
        'group/tabs flex gap-2 data-[orientation=horizontal]:flex-col',
        className,
      )}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'flex items-center gap-[2px] border-b border-border group-data-[orientation=vertical]/tabs:flex-col group-data-[orientation=vertical]/tabs:items-start group-data-[orientation=vertical]/tabs:border-b-0',
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        '-mb-px border-b-2 border-transparent px-[14px] py-[11px] text-[12.5px] font-semibold whitespace-nowrap text-text-3 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-primary data-[state=active]:text-primary-800',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
