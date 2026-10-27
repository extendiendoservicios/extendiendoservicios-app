import { useMemo, useState } from 'react'
import { PackageOpen } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DatePicker } from '@/components/DatePicker'
import { EmptyState } from '@/components/EmptyState'
import { UpdatedAgo } from '@/features/attendance/components/UpdatedAgo'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import { monthPeriod } from '@/features/stock/consumption'
import { supplyLabel } from '@/features/stock/filters'
import { formatDateTime } from '@/features/stock/labels'
import { formatMoney, formatQty } from '@/features/stock/money'
import { groupMovements } from '@/features/stock/movements'
import { withdrawalsSaleTotal } from '@/features/stock/personWithdrawals'
import { usePersonWithdrawalsQuery } from '@/features/stock/queries'
import { isoDateToDate } from './MovementFilters'

/**
 * Pestaña «Retiros» de la ficha del empleado y del coordinador (IS-18): los
 * insumos que retiró la persona (también los que la oficina cargó a su
 * nombre) con fecha, turno o sede, artículos, cantidades y la marca
 * «Anulado», y el total a venta del período (por defecto, el mes en curso).
 * Los retiros anulados no suman. Solo se ve en administración (dueño y
 * administradores): empleados y coordinadores no ven precios (IS-20).
 */
function PersonWithdrawalsTab({
  profileId,
  name,
}: {
  profileId: string
  name: string
}) {
  const today = todayInBuenosAires()
  const [period, setPeriod] = useState(() => monthPeriod(today, 0))
  const withdrawalsQuery = usePersonWithdrawalsQuery(
    profileId,
    period.dateFrom,
    period.dateTo,
  )
  const lines = withdrawalsQuery.data
  const withdrawals = useMemo(() => groupMovements(lines ?? []), [lines])
  const total = withdrawalsSaleTotal(withdrawals)
  const activeCount = withdrawals.filter((item) => !item.voidedAt).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-40">
            <DatePicker
              aria-label="Retiros desde"
              placeholder="Desde"
              value={isoDateToDate(period.dateFrom)}
              onValueChange={(date) => {
                if (date) {
                  setPeriod({ ...period, dateFrom: localDateToIsoDate(date) })
                }
              }}
              maxDate={isoDateToDate(period.dateTo)}
            />
          </div>
          <div className="w-40">
            <DatePicker
              aria-label="Retiros hasta"
              placeholder="Hasta"
              value={isoDateToDate(period.dateTo)}
              onValueChange={(date) => {
                if (date) {
                  setPeriod({ ...period, dateTo: localDateToIsoDate(date) })
                }
              }}
              minDate={isoDateToDate(period.dateFrom)}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPeriod(monthPeriod(today, 0))}
          >
            Este mes
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPeriod(monthPeriod(today, -1))}
          >
            Mes anterior
          </Button>
        </div>
        {withdrawalsQuery.dataUpdatedAt > 0 && (
          <UpdatedAgo dataUpdatedAt={withdrawalsQuery.dataUpdatedAt} />
        )}
      </div>

      {withdrawalsQuery.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-24" />
        </div>
      ) : withdrawals.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title={`${name} no retiró insumos en ese período`}
          description="Probá con otras fechas."
        />
      ) : (
        <>
          <div
            className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3"
            data-testid="person-withdrawals-total"
          >
            <p className="text-[12px] text-text-3">
              {activeCount === 1
                ? '1 retiro en el período'
                : `${activeCount} retiros en el período`}
              {withdrawals.length > activeCount
                ? ' (sin contar los anulados)'
                : ''}
            </p>
            <p className="text-[13px] font-semibold text-text">
              Total a venta:{' '}
              <span className="tabular-nums">{formatMoney(total)}</span>
            </p>
          </div>
          <ul
            className="flex flex-col gap-3"
            aria-label="Retiros de la persona"
          >
            {withdrawals.map((movement) => (
              <li
                key={movement.movementId}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
                data-testid="person-withdrawal"
                data-voided={movement.voidedAt ? 'true' : undefined}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-text">
                    {formatDateTime(movement.recordedAt)}
                    {movement.voidedAt && (
                      <Badge variant="neutral-strike">Anulado</Badge>
                    )}
                  </p>
                  <p className="text-[12.5px] tabular-nums text-text-2">
                    Venta{' '}
                    <span className="font-semibold text-text">
                      {formatMoney(Math.abs(movement.totalSale))}
                    </span>
                  </p>
                </div>
                {movement.place && (
                  <p className="text-[12.5px] text-text-2">{movement.place}</p>
                )}
                {movement.lines[0]?.note && (
                  <p className="text-[12.5px] text-text">
                    {movement.lines[0].note}
                  </p>
                )}
                {movement.recordedByName &&
                  movement.recordedByName !== name && (
                    <p className="text-[11.5px] text-text-3">
                      Lo cargó {movement.recordedByName}
                    </p>
                  )}
                <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                  {movement.lines.map((line) => (
                    <li
                      key={line.lineId}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]"
                    >
                      <span className="min-w-0 text-text">
                        {supplyLabel({
                          name: line.supplyName,
                          presentation: line.supplyPresentation,
                        })}
                      </span>
                      <span
                        className={
                          movement.voidedAt
                            ? 'font-semibold tabular-nums text-text-3 line-through'
                            : 'font-semibold tabular-nums text-text'
                        }
                      >
                        {formatQty(Math.abs(line.qtyDelta))}
                      </span>
                    </li>
                  ))}
                </ul>
                {movement.voidedAt && (
                  <p className="text-[12px] text-text-3">
                    Anulado por {movement.voidedByName ?? 'la administración'}
                    {movement.voidReason ? `: ${movement.voidReason}` : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export { PersonWithdrawalsTab }
