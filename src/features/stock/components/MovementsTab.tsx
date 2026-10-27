import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Ban, Download, History, MinusCircle, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { isApiError } from '@/api/errors'
import {
  fetchAllStockMovements,
  STOCK_MOVEMENTS_LIMIT,
  type StockMovementLine,
} from '@/api/stock'
import { useAuth } from '@/features/auth/AuthProvider'
import { UpdatedAgo } from '@/features/attendance/components/UpdatedAgo'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import {
  useStockClientOptionsQuery,
  useStockItemsQuery,
  useStockMovementsQuery,
  useStockPeopleQuery,
  useVoidStockMovementMutation,
  useWithdrawalSiteOptionsQuery,
} from '@/features/stock/queries'
import { downloadExcel } from '@/features/stock/excel'
import {
  MOVEMENT_EXCEL_COLUMNS,
  excelFileName,
} from '@/features/stock/exportSheets'
import {
  MOVEMENT_KIND_LABELS,
  describeMovementShift,
  formatDateTime,
  formatSignedQty,
} from '@/features/stock/labels'
import { formatMoney } from '@/features/stock/money'
import {
  DEFAULT_MOVEMENT_FILTERS,
  canVoidMovement,
  groupMovements,
  hasMovementFilters,
  toMovementFilters,
  type MovementFiltersState,
  type MovementGroup,
} from '@/features/stock/movements'
import { canManageStock } from '@/features/stock/permissions'
import { supplyLabel } from '@/features/stock/filters'
import { MovementFilters } from './MovementFilters'

/** Texto de lo que provoca anular, para que quien lo hace sepa qué pasa con el stock. */
export function describeVoidEffect(movement: MovementGroup): string {
  if (movement.kind === 'withdrawal') {
    return 'Las cantidades vuelven al stock.'
  }
  return 'Las cantidades se descuentan del stock. Si ya se usaron, no se va a poder anular.'
}

/**
 * Pestaña «Movimientos» de Insumos (IS-18, IS-27): los movimientos con sus
 * líneas, quién los registró, la persona, el turno o la sede, el proveedor, el
 * comprobante, la nota, los precios guardados y la marca «Anulado». Filtros
 * por fechas, tipo, persona, artículo, cliente y sede; «Anular» (con motivo
 * obligatorio, solo con `manage_stock`) y «Exportar a Excel» con lo filtrado.
 * Tocar un artículo abre su ficha; tocar una persona, la pestaña «Retiros»
 * de su ficha.
 */
function MovementsTab() {
  const auth = useAuth()
  const canManage = canManageStock(auth)
  const [filters, setFilters] = useState<MovementFiltersState>(
    DEFAULT_MOVEMENT_FILTERS,
  )
  const [voiding, setVoiding] = useState<MovementGroup | null>(null)
  const [exporting, setExporting] = useState(false)
  const voidMovement = useVoidStockMovementMutation()

  const apiFilters = useMemo(() => toMovementFilters(filters), [filters])
  const movementsQuery = useStockMovementsQuery(apiFilters)
  const itemsQuery = useStockItemsQuery()
  const peopleQuery = useStockPeopleQuery('all')
  const clientsQuery = useStockClientOptionsQuery()
  const sitesQuery = useWithdrawalSiteOptionsQuery()

  const lines = movementsQuery.data
  const groups = useMemo(() => groupMovements(lines ?? []), [lines])
  const reachedLimit = (lines?.length ?? 0) >= STOCK_MOVEMENTS_LIMIT

  async function handleExport() {
    setExporting(true)
    try {
      const all = await fetchAllStockMovements(apiFilters)
      if (all.length === 0) {
        toast.info('No hay movimientos para exportar con esos filtros.')
        return
      }
      await downloadExcel(
        excelFileName('movimientos-insumos', todayInBuenosAires()),
        {
          sheetName: 'Movimientos',
          columns: MOVEMENT_EXCEL_COLUMNS,
          rows: all,
        },
      )
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos armar el Excel. Probá de nuevo.',
      )
    } finally {
      setExporting(false)
    }
  }

  function handleVoid(reason: string) {
    if (!voiding) return
    voidMovement.mutate(
      { movementId: voiding.movementId, reason },
      {
        onSuccess: () => {
          toast.success(`${MOVEMENT_KIND_LABELS[voiding.kind]} anulado.`)
          setVoiding(null)
        },
        onError: (error) => {
          // El mensaje del servidor tal cual; el diálogo queda abierto.
          toast.error(
            isApiError(error)
              ? error.message
              : 'No pudimos anular el movimiento.',
          )
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <MovementFilters
          value={filters}
          onChange={setFilters}
          people={(peopleQuery.data ?? []).map((person) => ({
            value: person.profileId,
            label: `${person.firstName} ${person.lastName}`,
          }))}
          supplies={itemsQuery.data ?? []}
          clients={(clientsQuery.data ?? []).map((client) => ({
            value: client.id,
            label: client.name,
          }))}
          sites={(sitesQuery.data ?? []).map((site) => ({
            id: site.siteId,
            name: `${site.clientName} · ${site.siteName}`,
            clientId: site.clientId,
          }))}
        />
        <div className="flex items-center gap-3">
          {movementsQuery.dataUpdatedAt > 0 && (
            <UpdatedAgo dataUpdatedAt={movementsQuery.dataUpdatedAt} />
          )}
          <Button
            variant="ghost"
            icon={Download}
            loading={exporting}
            onClick={() => void handleExport()}
          >
            Exportar a Excel
          </Button>
        </div>
      </div>

      {movementsQuery.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={History}
          title={
            hasMovementFilters(filters)
              ? 'No hay movimientos con esos filtros'
              : 'Todavía no hay movimientos'
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Movimientos de insumos">
          {groups.map((movement) => (
            <MovementCard
              key={movement.movementId}
              movement={movement}
              canVoid={canVoidMovement(movement, canManage)}
              onVoid={() => setVoiding(movement)}
            />
          ))}
        </ul>
      )}

      {reachedLimit && (
        <p className="text-[11.5px] text-text-3">
          Se muestran los {STOCK_MOVEMENTS_LIMIT} movimientos más recientes.
          Acotá las fechas o los filtros para ver otros. El Excel trae todo lo
          filtrado.
        </p>
      )}

      <ConfirmDialog
        open={voiding != null}
        onOpenChange={(open) => {
          if (!open) setVoiding(null)
        }}
        title={
          voiding
            ? `Anular ${MOVEMENT_KIND_LABELS[voiding.kind].toLowerCase()}`
            : 'Anular'
        }
        description={
          voiding
            ? `${describeVoidEffect(voiding)} El movimiento queda marcado como anulado y no se puede deshacer.`
            : undefined
        }
        reasonLabel="Motivo de la anulación"
        confirmLabel="Anular"
        variant="destructive"
        isLoading={voidMovement.isPending}
        onConfirm={handleVoid}
      />
    </div>
  )
}

function MovementCard({
  movement,
  canVoid,
  onVoid,
}: {
  movement: MovementGroup
  canVoid: boolean
  onVoid: () => void
}) {
  const voided = movement.voidedAt != null
  const shift = movement.lines[0]
    ? describeMovementShift(movement.lines[0])
    : null
  return (
    <li
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      data-testid="movement-card"
      data-kind={movement.kind}
      data-voided={voided || undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-text">
            {MOVEMENT_KIND_LABELS[movement.kind]}
            {voided && <Badge variant="neutral-strike">Anulado</Badge>}
            {movement.reversesId && (
              <Badge variant="neutral" className="gap-1">
                <Undo2 aria-hidden="true" className="size-3" />
                Anula otro movimiento
              </Badge>
            )}
          </p>
          <p className="text-[12px] text-text-3">
            {formatDateTime(movement.recordedAt)}
            {movement.recordedByName
              ? ` · Registró ${movement.recordedByName}`
              : ''}
          </p>
        </div>
        {canVoid && (
          <Button
            variant="ghost"
            size="sm"
            icon={Ban}
            onClick={onVoid}
            aria-label={`Anular ${MOVEMENT_KIND_LABELS[movement.kind].toLowerCase()} del ${formatDateTime(movement.recordedAt)}`}
          >
            Anular
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
        {movement.personId && movement.personName && (
          <Fact label="Persona">
            <Link
              to={`/admin/empleados/${movement.personId}?pestana=retiros`}
              className="font-semibold text-primary-800 hover:underline"
            >
              {movement.personName}
            </Link>
          </Fact>
        )}
        {movement.place && (
          <Fact label={shift ? 'Turno' : 'Sede'}>{movement.place}</Fact>
        )}
        {movement.supplier && (
          <Fact label="Proveedor">{movement.supplier}</Fact>
        )}
        {movement.documentNumber && (
          <Fact label="Comprobante">{movement.documentNumber}</Fact>
        )}
        {movement.lines[0]?.kind === 'adjustment' && (
          <Fact label="Motivo">{movement.note ?? '—'}</Fact>
        )}
        {movement.lines[0]?.kind !== 'adjustment' &&
          movement.lines[0]?.note && (
            <Fact label="Observación">{movement.lines[0].note}</Fact>
          )}
      </dl>

      {voided && (
        <p className="flex items-start gap-2 rounded-md bg-secondary px-3 py-2 text-[12px] text-text-2">
          <MinusCircle
            aria-hidden="true"
            className="mt-[2px] size-3.5 shrink-0"
          />
          <span>
            Anulado por {movement.voidedByName ?? 'la administración'}
            {movement.voidReason ? `: ${movement.voidReason}` : ''}
          </span>
        </p>
      )}

      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {movement.lines.map((line) => (
          <MovementLineRow key={line.lineId} line={line} voided={voided} />
        ))}
      </ul>

      <p className="flex flex-wrap justify-end gap-x-5 gap-y-1 text-[12px] text-text-2">
        <span>
          Costo total:{' '}
          <span className="font-semibold tabular-nums">
            {formatMoney(Math.abs(movement.totalCost))}
          </span>
        </span>
        <span>
          Venta total:{' '}
          <span className="font-semibold tabular-nums">
            {formatMoney(Math.abs(movement.totalSale))}
          </span>
        </span>
      </p>
    </li>
  )
}

function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-text-3">{label}:</dt>
      <dd className="min-w-0 text-text [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

function MovementLineRow({
  line,
  voided,
}: {
  line: StockMovementLine
  voided: boolean
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-[12.5px]">
      <Link
        to={`/admin/insumos/${line.supplyId}`}
        className="min-w-0 font-semibold text-text hover:text-primary-800 hover:underline max-md:min-h-11 max-md:content-center"
      >
        {supplyLabel({
          name: line.supplyName,
          presentation: line.supplyPresentation,
        })}
        <span className="ml-2 font-mono text-[11px] font-normal text-text-3">
          {line.supplyCode}
        </span>
      </Link>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-text-2">
        <span
          className={
            voided
              ? 'font-semibold tabular-nums text-text-3 line-through'
              : 'font-semibold tabular-nums text-text'
          }
        >
          {formatSignedQty(line.qtyDelta)}
        </span>
        <span className="tabular-nums">
          Costo {formatMoney(line.unitCost)} · Venta{' '}
          {formatMoney(line.unitSale)}
        </span>
        <span className="tabular-nums text-text-3">
          Stock resultante {line.stockAfter}
        </span>
      </span>
    </li>
  )
}

export { MovementsTab }
