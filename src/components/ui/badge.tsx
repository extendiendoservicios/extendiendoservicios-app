import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import { Slot } from 'radix-ui'

/**
 * Badge (DS-007): base de `StatusBadge` (`src/components/status/`). Variantes
 * exactas de `07_Design_System.md` sección 3, colores de `.badge`/`.b-*` de
 * `Mockup/assets/ds.css` (los `-800` ya dan ≥4.5:1 sobre su fondo claro,
 * sección 1 de `07`).
 */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-[5px] rounded-full px-[9px] py-[3px] text-[11px] leading-[1.5] font-semibold whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'bg-secondary text-text-2',
        primary: 'bg-primary-100 text-primary-800',
        success: 'bg-success-bg text-success-800',
        warning: 'bg-warning-bg text-warning-800',
        danger: 'bg-danger-bg text-danger-800',
        info: 'bg-info-bg text-info-800',
        dark: 'bg-dark text-white',
        'neutral-strike': 'bg-secondary text-text-2 line-through',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
)

function Badge({
  className,
  variant = 'neutral',
  dot = false,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
    /** Punto de 6 px antes del texto (`07` sección 2.3). */
    dot?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'span'

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="size-[6px] shrink-0 rounded-full bg-current"
        />
      )}
      {children}
    </Comp>
  )
}

export { Badge, badgeVariants }
