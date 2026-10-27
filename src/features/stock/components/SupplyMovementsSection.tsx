import { useState } from 'react'
import { History, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { DatePicker } from '@/components/DatePicker'
import { UpdatedAgo } from '@/features/attendance/components/UpdatedAgo'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import { STOCK_MOVEMENTS_LIMIT, type StockMovementLine } from '@/api/stock'
import { useStockMovementsQuery } from '@/features/stock/queries'
import {
  MOVEMENT_KIND_LABELS,
  describeMovementNote,
  describeMovementPerson,
  describeMovementPlace,
  formatDateTime,
  formatSignedQty,
} from '@/features/stock/labels'

/** `"YYYY-MM-DD"` -> `Date` para `DatePicker`. */
function isoDateToDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

/**
 * Movimientos de un artículo en su ficha, con filtro de fechas (IS-18):
 * fecha y hora, tipo, cantidad con signo, stock resultante, persona, turno o
 * sede, observación y la marca «Anulado». La anulación se hace desde
 * Movimientos (P25.3): acá solo se muestra.
 */
function SupplyMovementsSection({ supplyId }: { supplyId: string }) {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const movementsQuery = useStockMovementsQuery({
    supplyId,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  })
  const rows = movementsQuery.data ?? []

  const columns: DataTableColumnDef<StockMovementLine>[] = [
    {
      id: 'when',
      header: 'Fecha y hora',
      enableSorting: false,
      meta: { card: 'title' },
      cell: ({ row }) => (
        <span className="font-semibold whitespace-nowrap">
          {formatDateTime(row.original.recordedAt)}
        </span>
      ),
    },
    {
      id: 'kind',
      header: 'Tipo',
      enableSorting: false,
      meta: { card: 'subtitle' },
      cell: ({ row }) => (
        <span className="inline-flex flex-wrap items-center gap-[6px]">
          {MOVEMENT_KIND_LABELS[row.original.kind]}
          {row.original.voidedAt && (
            <Badge variant="neutral-strike">Anulado</Badge>
          )}
        </span>
      ),
    },
    {
      id: 'qty',
      header: 'Cantidad',
      enableSorting: false,
      meta: { card: 'trailing', align: 'end' },
      cell: ({ row }) => (
        <span
          className={
            row.original.voidedAt
              ? 'font-semibold tabular-nums text-text-3 line-through'
              : 'font-semibold tabular-nums'
          }
        >
          {formatSignedQty(row.original.qtyDelta)}
        </span>
      ),
    },
    {
      id: 'after',
      header: 'Stock resultante',
      enableSorting: false,
      meta: { card: 'meta', cardLabel: 'Stock resultante', align: 'end' },
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.stockAfter}</span>
      ),
    },
    {
      id: 'person',
      header: 'Persona',
      enableSorting: false,
      meta: { card: 'meta', cardLabel: 'Persona' },
      cell: ({ row }) => describeMovementPerson(row.original) ?? '—',
    },
    {
      id: 'place',
      header: 'Turno o sede',
      enableSorting: false,
      meta: { card: 'meta', cardLabel: 'Turno o sede' },
      cell: ({ row }) => describeMovementPlace(row.original) ?? '—',
    },
    {
      id: 'note',
      header: 'Observación',
      enableSorting: false,
      meta: { card: 'meta', cardLabel: 'Observación' },
      cell: ({ row }) => {
        const line = row.original
        const note = describeMovementNote(line)
        return (
          <span className="block whitespace-normal">
            {note ?? '—'}
            {line.voidedAt && (
              <span className="mt-[2px] block text-[11px] text-text-3">
                Anulado por {line.voidedByName ?? 'administración'}
                {line.voidReason ? `: ${line.voidReason}` : ''}
              </span>
            )}
          </span>
        )
      },
    },
  ]

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold text-text">Movimientos</h2>
        <div className="flex flex-wrap items-center gap-2">
          {movementsQuery.dataUpdatedAt > 0 && (
            <UpdatedAgo dataUpdatedAt={movementsQuery.dataUpdatedAt} />
          )}
          <div className="w-40">
            <DatePicker
              aria-label="Movimientos desde"
              placeholder="Desde"
              value={dateFrom ? isoDateToDate(dateFrom) : undefined}
              onValueChange={(date) =>
                setDateFrom(date ? localDateToIsoDate(date) : '')
              }
              maxDate={dateTo ? isoDateToDate(dateTo) : undefined}
            />
          </div>
          <div className="w-40">
            <DatePicker
              aria-label="Movimientos hasta"
              placeholder="Hasta"
              value={dateTo ? isoDateToDate(dateTo) : undefined}
              onValueChange={(date) =>
                setDateTo(date ? localDateToIsoDate(date) : '')
              }
              minDate={dateFrom ? isoDateToDate(dateFrom) : undefined}
            />
          </div>
          {(dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              onClick={() => {
                setDateFrom('')
                setDateTo('')
              }}
            >
              Limpiar fechas
            </Button>
          )}
        </div>
      </div>

      <DataTable
        caption="Movimientos del artículo"
        columns={columns}
        data={rows}
        getRowId={(row) => row.lineId}
        isLoading={movementsQuery.isLoading}
        compact
        emptyState={{
          icon: History,
          title:
            dateFrom || dateTo
              ? 'No hay movimientos en esas fechas'
              : 'Este artículo todavía no tuvo movimientos',
        }}
      />
      {rows.length >= STOCK_MOVEMENTS_LIMIT && (
        <p className="text-[11.5px] text-text-3">
          Se muestran los {STOCK_MOVEMENTS_LIMIT} movimientos más recientes.
          Acotá las fechas para ver otros.
        </p>
      )}
    </section>
  )
}

export { SupplyMovementsSection }
