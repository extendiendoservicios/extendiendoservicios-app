import { cn } from 'cn'
import { useStockSummaryQuery } from '@/features/stock/queries'
import type { AdminNavBadge } from './adminNav'

/** Texto del número: hasta 99; después «99+». */
export function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

/**
 * Número pegado a un ítem de la barra de administración. Hoy solo hay uno:
 * los avisos de faltante abiertos junto a «Insumos» (IS-33, `get_stock_summary`).
 * No se muestra en cero, mientras carga ni si falla: la navegación no
 * depende de este número. `AdminShell` solo se monta para el dueño y los
 * administradores, que son quienes pueden leer el contador.
 */
function NavBadge({
  kind,
  className,
}: {
  kind: AdminNavBadge
  className?: string
}) {
  const summaryQuery = useStockSummaryQuery()
  const count = kind === 'stockOpenReports' ? summaryQuery.data?.openReports : 0
  if (!count || count <= 0) {
    return null
  }
  return (
    <span
      className={cn(
        'inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-warning-bg px-[5px] text-[10.5px] leading-[18px] font-bold text-warning-800 tabular-nums',
        className,
      )}
      data-testid="nav-badge"
    >
      <span aria-hidden="true">{formatBadgeCount(count)}</span>
      <span className="sr-only">
        {count === 1
          ? '1 aviso de faltante abierto'
          : `${count} avisos de faltante abiertos`}
      </span>
    </span>
  )
}

export { NavBadge }
