import { Tag } from 'lucide-react'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import type { SupplyPriceChange } from '@/api/stock'
import { useSupplyPriceChangesQuery } from '@/features/stock/queries'
import { formatDateTime, priceSourceLabel } from '@/features/stock/labels'
import { formatMoney } from '@/features/stock/money'

/** «de $ 800,00 a $ 950,00»; en el alta (sin valor anterior), solo el valor inicial. */
function describePriceChange(
  oldValue: number | null,
  newValue: number,
): string {
  return oldValue == null
    ? formatMoney(newValue)
    : `de ${formatMoney(oldValue)} a ${formatMoney(newValue)}`
}

const columns: DataTableColumnDef<SupplyPriceChange>[] = [
  {
    id: 'when',
    header: 'Cuándo',
    enableSorting: false,
    meta: { card: 'title' },
    cell: ({ row }) => (
      <span className="font-semibold whitespace-nowrap">
        {formatDateTime(row.original.changedAt)}
      </span>
    ),
  },
  {
    id: 'who',
    header: 'Quién',
    enableSorting: false,
    meta: { card: 'subtitle' },
    cell: ({ row }) => row.original.changedByName ?? 'Sistema',
  },
  {
    id: 'cost',
    header: 'Costo',
    enableSorting: false,
    meta: { card: 'meta', cardLabel: 'Costo' },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {describePriceChange(
          row.original.oldCostPrice,
          row.original.newCostPrice,
        )}
      </span>
    ),
  },
  {
    id: 'sale',
    header: 'Venta',
    enableSorting: false,
    meta: { card: 'meta', cardLabel: 'Venta' },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {describePriceChange(
          row.original.oldSalePrice,
          row.original.newSalePrice,
        )}
      </span>
    ),
  },
  {
    id: 'source',
    header: 'Origen',
    enableSorting: false,
    meta: { card: 'meta', cardLabel: 'Origen' },
    cell: ({ row }) => priceSourceLabel(row.original.source),
  },
]

/**
 * Historial de precios de la ficha (IS-22): quién, cuándo y de cuánto a
 * cuánto, del cambio más reciente al más antiguo.
 */
function PriceHistorySection({ supplyId }: { supplyId: string }) {
  const changesQuery = useSupplyPriceChangesQuery(supplyId)
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <h2 className="text-[14px] font-semibold text-text">
        Historial de precios
      </h2>
      <DataTable
        caption="Historial de precios del artículo"
        columns={columns}
        data={changesQuery.data ?? []}
        getRowId={(row) => row.id}
        isLoading={changesQuery.isLoading}
        compact
        emptyState={{ icon: Tag, title: 'Todavía no hay cambios de precio' }}
      />
    </section>
  )
}

export { PriceHistorySection }
