import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'

/**
 * KpiCard (DS-006): `07` sección 2.3, `.kpi`/`.kpi-l`/`.kpi-v`/`.kpi-d` de
 * `Mockup/assets/ds.css` (D01). La etiqueta queda en 11.5 px tal como la
 * escribe `07` (no la redondea, a diferencia de la nota general de
 * normalización de la sección 4).
 */
const kpiCardVariants = cva(
  'rounded-lg border border-border bg-surface px-[15px] py-[13px] shadow-card',
  {
    variants: {
      variant: {
        default: '',
        accent:
          'border-primary-200 bg-[linear-gradient(180deg,var(--primary-050),var(--surface)_60%)]',
        ok: '',
        warn: '',
        crit: '',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const kpiValueVariants = cva(
  'mt-[3px] text-[26px] leading-[1.05] font-bold tracking-[-0.9px] text-text tabular-nums',
  {
    variants: {
      variant: {
        default: '',
        accent: '',
        ok: 'text-success',
        warn: 'text-warning',
        crit: 'text-danger',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

interface KpiCardProps extends VariantProps<typeof kpiCardVariants> {
  label: string
  value: React.ReactNode
  detail?: string
  icon?: React.ComponentType<{ className?: string }>
  className?: string
}

function KpiCard({
  label,
  value,
  detail,
  icon: Icon,
  variant = 'default',
  className,
}: KpiCardProps) {
  return (
    <div className={cn(kpiCardVariants({ variant }), className)}>
      <div className="flex items-center gap-[6px] text-[11.5px] font-medium text-text-3">
        {Icon && <Icon aria-hidden="true" className="size-[14px]" />}
        {label}
      </div>
      <div className={cn(kpiValueVariants({ variant }))}>{value}</div>
      {detail && (
        <div className="mt-[3px] text-[11px] text-text-3">{detail}</div>
      )}
    </div>
  )
}

export { KpiCard }
