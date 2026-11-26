import { useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MonthPicker } from '@/components/MonthPicker'
import { Skeleton } from '@/components/ui/skeleton'
import { useSearchParamsPatch } from '@/hooks/useSearchParamsPatch'
import {
  useAssignmentsBoardRangeQuery,
  useShiftsBoardRangeQuery,
} from '@/features/planning/queries'
import { useClientSitesQuery } from '@/features/clients/queries'
import { useHolidaysQuery } from '@/features/settings/queries'
import { PrintSheet } from '@/features/print/PrintSheet'
import {
  formatMonthParam,
  resolveMonth,
} from '@/features/employees/calendarioMonth'
import { monthRange } from '@/features/employees/cronograma'
import {
  buildClientCalendarMonth,
  describeFilters,
  employeeOptions,
  uncoveredLabel,
} from '@/features/clients/clientCalendar'
import { ClientCalendarMonth } from '@/features/clients/components/ClientCalendarMonth'

const SELECT_CLASS =
  'h-9 min-w-0 rounded-md border border-border bg-surface px-2 text-[13px] text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

/**
 * Pestaña «Calendario» de la ficha del cliente (ADM-21, P34.1, OL-01): todos
 * los turnos del cliente en todas sus sedes, mes por mes, con la misma hoja del
 * calendario del empleado pero con un bloque por turno. El mes y los filtros
 * de sede y empleado viven en la dirección (`mes=`, `sede=`, `empleado=`).
 *
 * `canEdit` (D-02) queda listo para P34.2; en P34.1 todo es lectura.
 */
function ClientCalendarioTab({
  clientId,
  clientName,
  canEdit = false,
}: {
  clientId: string
  clientName: string
  /** Dueño o administrador con permiso sobre turnos y horarios (P34.2). */
  canEdit?: boolean
}) {
  const [params, updateParams] = useSearchParamsPatch({
    mes: '',
    sede: '',
    empleado: '',
  })
  const { year, month: monthNumber } = resolveMonth(
    params.mes || null,
    new Date(),
  )
  const monthDate = useMemo(
    () => new Date(year, monthNumber - 1, 1),
    [year, monthNumber],
  )
  const { from, to } = monthRange(year, monthNumber)
  const siteId = params.sede || undefined
  const employeeId = params.empleado || undefined

  const [printing, setPrinting] = useState(false)
  const [highlightUncovered, setHighlightUncovered] = useState(false)

  const sitesQuery = useClientSitesQuery(clientId)
  const shiftsQuery = useShiftsBoardRangeQuery(from, to, {
    clientId,
    siteId,
    employeeId,
  })
  const assignmentsQuery = useAssignmentsBoardRangeQuery(from, to, {
    clientId,
    siteId,
    onlyActive: true,
  })
  const holidaysQuery = useHolidaysQuery(year)

  const assignments = useMemo(
    () => assignmentsQuery.data ?? [],
    [assignmentsQuery.data],
  )
  const month = useMemo(
    () =>
      buildClientCalendarMonth({
        year,
        month: monthNumber,
        shifts: shiftsQuery.data ?? [],
        assignments,
        holidays: holidaysQuery.data ?? [],
      }),
    [year, monthNumber, shiftsQuery.data, assignments, holidaysQuery.data],
  )
  const employees = useMemo(() => employeeOptions(assignments), [assignments])

  const isLoading =
    shiftsQuery.isLoading ||
    assignmentsQuery.isLoading ||
    holidaysQuery.isLoading
  const hasError =
    shiftsQuery.isError || assignmentsQuery.isError || holidaysQuery.isError

  const sites = sitesQuery.data ?? []
  const filtersText = describeFilters({
    siteName: sites.find((site) => site.id === siteId)?.name ?? null,
    employeeName:
      employees.find((employee) => employee.employeeId === employeeId)?.name ??
      null,
  })

  function changeMonth(date: Date) {
    updateParams({
      mes: formatMonthParam(date.getFullYear(), date.getMonth() + 1),
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker
          value={monthDate}
          onValueChange={changeMonth}
          aria-label="Mes del calendario"
        />
        <select
          aria-label="Sede"
          className={SELECT_CLASS}
          value={siteId ?? ''}
          onChange={(event) => updateParams({ sede: event.target.value })}
        >
          <option value="">Todas las sedes</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Empleado"
          className={SELECT_CLASS}
          value={employeeId ?? ''}
          onChange={(event) => updateParams({ empleado: event.target.value })}
        >
          <option value="">Todos los empleados</option>
          {employees.map((employee) => (
            <option key={employee.employeeId} value={employee.employeeId}>
              {employee.name}
            </option>
          ))}
        </select>
        <Button
          icon={Printer}
          variant="dark"
          disabled={isLoading || hasError}
          onClick={() => setPrinting(true)}
        >
          Imprimir
        </Button>
      </div>

      {hasError ? (
        <p role="alert" className="text-[13px] text-danger">
          No pudimos cargar el calendario. Probá de nuevo en un momento.
        </p>
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          {month.uncoveredCount > 0 && (
            <button
              type="button"
              aria-pressed={highlightUncovered}
              className="self-start text-[13px] font-semibold text-danger hover:underline"
              onClick={() => setHighlightUncovered((current) => !current)}
            >
              {uncoveredLabel(month.uncoveredCount)}
            </button>
          )}
          <div className="min-w-0 overflow-x-auto rounded-md border border-border bg-white p-3">
            <ClientCalendarMonth
              month={month}
              canEdit={canEdit}
              highlightUncovered={highlightUncovered}
            />
          </div>
        </>
      )}

      {printing && (
        <PrintSheet
          documentTitle={`Calendario - ${clientName} - ${month.title}`}
          onClose={() => setPrinting(false)}
          orientation="landscape"
        >
          <p className="mb-1 text-[12px] font-bold text-black">
            {clientName} · {filtersText}
          </p>
          <ClientCalendarMonth month={month} printing />
        </PrintSheet>
      )}
    </div>
  )
}

export { ClientCalendarioTab }
