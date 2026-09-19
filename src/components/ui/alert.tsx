import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'

/**
 * Alert / Banner (DS-010): `07` sección 2.3 — variantes `crit`, `warn` e
 * `info`; ícono 17 px; título 12.5 px, texto 11.5 px (valores tal cual los
 * escribe `07`, no se redondean — mismo criterio que `KpiCard`/`EmptyState`).
 * Colores exactos de `.alert`/`.a-crit`/`.a-warn`/`.a-info`
 * (`Mockup/assets/ds.css`).
 *
 * Uso: `<Alert variant="crit"><TriangleAlert /><div><AlertTitle>…
 * </AlertTitle><AlertDescription>…</AlertDescription></div></Alert>` — el
 * ícono es el primer hijo directo (como en `ds.css`, `display:flex`), no un
 * slot separado.
 */
const alertVariants = cva(
  "flex items-start gap-[11px] rounded-[var(--r)] border px-[14px] py-3 text-left [&>svg]:mt-px [&>svg]:size-[17px] [&>svg]:shrink-0 [&>svg:not([class*='size-'])]:size-[17px]",
  {
    variants: {
      variant: {
        crit: 'border-danger-border bg-danger-bg text-danger-800 [&>svg]:stroke-danger',
        warn: 'border-warning-border bg-warning-bg text-warning-800 [&>svg]:stroke-warning',
        info: 'border-primary-200 bg-primary-50 text-primary-800 [&>svg]:stroke-primary',
      },
    },
    defaultVariants: {
      variant: 'info',
    },
  },
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('text-[12.5px] leading-[1.3] font-semibold', className)}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'mt-[2px] text-[11.5px] leading-[1.4] text-text-2',
        className,
      )}
      {...props}
    />
  )
}

function AlertActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-actions"
      className={cn('mt-2 flex items-center gap-2', className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertActions, alertVariants }
