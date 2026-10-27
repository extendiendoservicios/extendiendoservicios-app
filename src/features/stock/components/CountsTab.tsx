import { ClipboardCheck, ClipboardList } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import type { StockCountRecord } from '@/api/stock'
import { useAuth } from '@/features/auth/AuthProvider'
import { UpdatedAgo } from '@/features/attendance/components/UpdatedAgo'
import { useStockCountsQuery } from '@/features/stock/queries'
import { formatDateTime } from '@/features/stock/labels'
import { canManageStock } from '@/features/stock/permissions'
import { CountLinesTable } from './CountLinesTable'

/**
 * Pestaña «Controles» de Insumos (IS-16, IS-31): el historial de controles
 * cargados, con la fecha y hora del conteo, quién revisó, quién lo cargó, las
 * observaciones y el detalle de las diferencias. «Cargar control» solo con
 * `manage_stock` (IS-21).
 */
function CountsTab() {
  const auth = useAuth()
  const canManage = canManageStock(auth)
  const countsQuery = useStockCountsQuery()
  const counts = countsQuery.data ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {countsQuery.dataUpdatedAt > 0 && (
            <UpdatedAgo dataUpdatedAt={countsQuery.dataUpdatedAt} />
          )}
        </div>
        {canManage && (
          <Button asChild icon={ClipboardCheck}>
            <Link to="/admin/insumos/control">Cargar control</Link>
          </Button>
        )}
      </div>

      {countsQuery.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : counts.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Todavía no se cargó ningún control"
          description={
            canManage
              ? 'Imprimí la planilla desde Stock, contá y pasá lo contado con «Cargar control».'
              : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Controles de stock">
          {counts.map((count) => (
            <CountCard key={count.countId} count={count} />
          ))}
        </ul>
      )}
    </div>
  )
}

function CountCard({ count }: { count: StockCountRecord }) {
  const differences = count.lines.filter((line) => line.difference !== 0)
  return (
    <li
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      data-testid="count-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-text">
            Control del {formatDateTime(count.countedAt)}
          </p>
          <p className="text-[12px] text-text-3">
            Revisó {count.reviewerName ?? 'sin indicar'}
            {count.createdByName ? ` · Lo cargó ${count.createdByName}` : ''}
            {count.createdAt ? ` el ${formatDateTime(count.createdAt)}` : ''}
          </p>
        </div>
        <Badge variant={count.differencesCount > 0 ? 'warning' : 'success'}>
          {count.differencesCount === 0
            ? 'Sin diferencias'
            : count.differencesCount === 1
              ? '1 diferencia'
              : `${count.differencesCount} diferencias`}
        </Badge>
      </div>
      {count.notes && <p className="text-[12.5px] text-text">{count.notes}</p>}
      <p className="text-[12px] text-text-2">
        {count.linesCount === 1
          ? '1 artículo contado'
          : `${count.linesCount} artículos contados`}
        {differences.length === 0 ? '.' : ':'}
      </p>
      {differences.length > 0 && (
        <CountLinesTable
          lines={differences}
          caption={`Diferencias del control del ${formatDateTime(count.countedAt)}`}
        />
      )}
    </li>
  )
}

export { CountsTab }
