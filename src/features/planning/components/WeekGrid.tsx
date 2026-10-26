import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getStatusMeta } from '@/components/status'
import type { ShiftStatus as BadgeShiftStatus } from '@/components/status'
import { IconButton } from '@/components/IconButton'
import { Input } from '@/components/ui/input'
import { Combobox } from '@/components/Combobox'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { useEmployeesQuery } from '@/features/employees/queries'
import {
  useClientFilterOptionsQuery,
  useSitesMapQuery,
} from '@/features/sites/queries'
import {
  addWeeksToIsoDate,
  startOfWeekIso,
  weekDaysIso,
} from '@/features/planning/planningDates'
import {
  groupAssignmentsByEmployeeAndDate,
  legendClientsOf,
} from '@/features/planning/grouping'
import { useColorBy } from '@/features/planning/colorBy'
import { clientChipColors } from '@/features/planning/clientColors'
import { ColorByToggle } from '@/features/planning/components/ColorByToggle'
import {
  ClientLegend,
  StatusDotLegend,
} from '@/features/planning/components/ColorLegends'
import { StatusDot } from '@/features/planning/components/ShiftChip'
import { useAssignmentsBoardRangeQuery } from '@/features/planning/queries'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { formatShiftRange } from '@/features/shifts/openEnded'

const DESKTOP_QUERY = '(min-width: 1024px)'

/**
 * Ancho mínimo de la grilla (P19.11d): 144 px de la columna de empleados más
 * 7 días de 88 px como mínimo (760 px). Con el menú lateral abierto el contenido mide
 * 736 px a 1024 px de pantalla (algo menos que esto: hay desplazamiento
 * horizontal), 992 px a 1280, 1078 px a 1366 y 1152 px a 1440 (entra sin
 * desplazar). Con el menú cerrado entra en todos.
 */
const WEEK_GRID_MIN_WIDTH = 'min-w-[760px]'

/**
 * Horario del chip (P19.11d): es el dato principal y nunca se recorta. Va en
 * su propia línea, sin cortes y con cifras de ancho fijo en 10.5 px (unos
 * 62 px: entra en los 72 px útiles de una celda de 88 px). Con "A terminar"
 * (largo) se parte en dos líneas: "08:00–" y "A terminar".
 */
function ShiftRange({
  startTime,
  endTime,
  openEnded,
}: {
  startTime: string
  endTime: string | null | undefined
  openEnded: boolean | null | undefined
}) {
  const range = formatShiftRange(startTime, endTime, openEnded)
  const closed = !openEnded && endTime
  if (closed) {
    return (
      <span
        data-testid="week-chip-range"
        className="block text-[10.5px] whitespace-nowrap tabular-nums"
      >
        {range}
      </span>
    )
  }
  const [from, to] = range.split('–')
  return (
    <span data-testid="week-chip-range" className="block text-[10.5px]">
      <span className="block whitespace-nowrap tabular-nums">{from}–</span>
      <span className="block whitespace-nowrap">{to}</span>
    </span>
  )
}

/**
 * ADM-04 "Planificación · semana por empleado" (ASSIGN-009, `05` línea 38):
 * grilla empleados × 7 días, una tarjeta por asignación con sede y franja
 * (la propia si la tiene, `effective_start_time`/`effective_end_time` de
 * `v_assignments_board`); celdas vacías "libre"; empleados de licencia
 * atenuados. Filtros cliente, sede, texto. Semana anterior y siguiente.
 * Sin arrastre (P-055, módulo G).
 *
 * Cada tarjeta es un enlace directo a `/admin/turnos/:id` (ADM-06,
 * ASSIGN-011), y el nombre del empleado lleva a su ficha.
 *
 * Debajo de 1024 px (`05` sección 7: "Grilla semanal → un empleado por vez
 * con selector"): se elige un empleado con un `Combobox` y se ve su semana
 * como una lista vertical de 7 días.
 */
function WeekGrid() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const today = todayInBuenosAires()

  const [weekStart, setWeekStart] = useState(() => startOfWeekIso(today))
  const [clientId, setClientId] = useState<string>('all')
  const [siteId, setSiteId] = useState<string>('all')
  const [text, setText] = useState('')
  const debouncedText = useDebouncedValue(text)
  const [mobileEmployeeId, setMobileEmployeeId] = useState<string>('')
  const [colorBy, setColorBy] = useColorBy()

  const weekDays = useMemo(() => weekDaysIso(weekStart), [weekStart])

  const employeesQuery = useEmployeesQuery({
    role: 'employee',
    text: debouncedText,
  })
  const employees = useMemo(
    () =>
      (employeesQuery.data ?? []).filter(
        (employee) => employee.effectiveStatus !== 'terminated',
      ),
    [employeesQuery.data],
  )

  const assignmentsQuery = useAssignmentsBoardRangeQuery(
    weekDays[0] as string,
    weekDays[6] as string,
    {
      clientId: clientId !== 'all' ? clientId : undefined,
      siteId: siteId !== 'all' ? siteId : undefined,
      // La vista trae también las quitadas (quedan para historia).
      onlyActive: true,
    },
  )
  const assignmentsByEmployee = useMemo(
    () => groupAssignmentsByEmployeeAndDate(assignmentsQuery.data ?? []),
    [assignmentsQuery.data],
  )

  // Leyenda: todos los clientes de la semana, aunque el filtro deje uno solo.
  const legendQuery = useAssignmentsBoardRangeQuery(
    weekDays[0] as string,
    weekDays[6] as string,
    {
      siteId: siteId !== 'all' ? siteId : undefined,
      onlyActive: true,
    },
    colorBy === 'client',
  )
  const legendClients = useMemo(
    () => legendClientsOf(legendQuery.data ?? []),
    [legendQuery.data],
  )

  const clientOptionsQuery = useClientFilterOptionsQuery()
  const sitesQuery = useSitesMapQuery({})
  const siteOptions = useMemo(
    () =>
      (sitesQuery.data ?? []).filter(
        (site) => clientId === 'all' || site.clientId === clientId,
      ),
    [sitesQuery.data, clientId],
  )

  const mobileEmployee =
    employees.find((employee) => employee.profileId === mobileEmployeeId) ??
    employees[0]

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <IconButton
            icon={ChevronLeft}
            aria-label="Semana anterior"
            onClick={() =>
              setWeekStart((current) => addWeeksToIsoDate(current, -1))
            }
          />
          <span className="text-[13px] font-semibold text-text">
            {formatDateOnly(weekDays[0] as string)} –{' '}
            {formatDateOnly(weekDays[6] as string)}
          </span>
          <IconButton
            icon={ChevronRight}
            aria-label="Semana siguiente"
            onClick={() =>
              setWeekStart((current) => addWeeksToIsoDate(current, 1))
            }
          />
          {weekStart !== startOfWeekIso(today) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWeekStart(startOfWeekIso(today))}
            >
              Esta semana
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          icon={Search}
          placeholder="Buscar empleado…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="w-56"
        />
        <Combobox
          aria-label="Filtrar por cliente"
          placeholder="Todos los clientes"
          className="w-52"
          value={clientId}
          onValueChange={(value) => {
            setClientId(value)
            setSiteId('all')
          }}
          options={[
            { value: 'all', label: 'Todos los clientes' },
            ...(clientOptionsQuery.data ?? []).map((option) => ({
              value: option.id,
              label: option.name,
            })),
          ]}
        />
        <Combobox
          aria-label="Filtrar por sede"
          placeholder="Todas las sedes"
          className="w-52"
          value={siteId}
          onValueChange={setSiteId}
          options={[
            { value: 'all', label: 'Todas las sedes' },
            ...siteOptions.map((option) => ({
              value: option.id,
              label: option.name,
            })),
          ]}
        />
        <ColorByToggle value={colorBy} onValueChange={setColorBy} />
      </div>

      {colorBy === 'client' && (
        <ClientLegend
          title="Clientes de la semana"
          clients={legendClients}
          selectedId={clientId !== 'all' ? clientId : null}
          onSelect={(id) => {
            setClientId(id ?? 'all')
            setSiteId('all')
          }}
        />
      )}

      {isDesktop ? (
        // P19.11d: la grilla se ajusta sola al ancho disponible (la columna de
        // empleados tiene ancho fijo y los 7 días se reparten el resto en
        // partes iguales; la sede se recorta con puntos suspensivos y el
        // horario nunca) y,
        // si ni así entra (menos de `WEEK_GRID_MIN_WIDTH`), el contenedor
        // desplaza en horizontal con la columna de empleados y los días
        // fijos. El contenedor también tiene alto máximo: así la barra de
        // desplazamiento horizontal queda siempre a la vista, no al final de
        // una lista larga.
        <div
          data-testid="week-grid-scroll"
          className="max-h-[calc(100dvh-16rem)] min-h-64 overflow-auto rounded-lg border border-border bg-surface"
        >
          <table
            data-testid="week-grid-table"
            className={`w-full ${WEEK_GRID_MIN_WIDTH} table-fixed border-separate border-spacing-0 text-[12.5px]`}
          >
            <thead>
              <tr className="text-left text-[11px] font-semibold text-text-3">
                <th className="sticky top-0 left-0 z-30 w-36 border-r border-b border-border bg-secondary px-2 py-2">
                  Empleado
                </th>
                {weekDays.map((day) => (
                  <th
                    key={day}
                    className="sticky top-0 z-20 truncate border-b border-border bg-secondary px-2 py-2 capitalize"
                  >
                    {formatDateOnly(day)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="[&_tr:last-child_td]:border-b-0">
              {employees.map((employee) => {
                const byDate = assignmentsByEmployee.get(employee.profileId)
                const onLeave = employee.effectiveStatus === 'on_leave'
                const fullName = `${employee.firstName} ${employee.lastName}`
                return (
                  <tr key={employee.profileId}>
                    <td className="sticky left-0 z-10 border-r border-b border-border bg-surface px-2 py-2 font-semibold text-text">
                      <div className={onLeave ? 'opacity-50' : undefined}>
                        <Link
                          to={`/admin/empleados/${employee.profileId}`}
                          title={fullName}
                          className="block truncate rounded outline-none hover:text-primary-800 hover:underline focus-visible:ring-3 focus-visible:ring-ring"
                        >
                          {fullName}
                        </Link>
                        {onLeave && (
                          <span className="block truncate text-[10.5px] font-medium text-text-3">
                            (de licencia)
                          </span>
                        )}
                      </div>
                    </td>
                    {weekDays.map((day) => {
                      const dayAssignments = byDate?.get(day) ?? []
                      return (
                        <td
                          key={day}
                          className="border-b border-border px-1 py-2 align-top"
                        >
                          <div
                            className={`min-w-0 ${onLeave ? 'opacity-50' : ''}`}
                          >
                            {dayAssignments.length === 0 ? (
                              <span className="text-text-3">Libre</span>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {dayAssignments.map((assignment) => {
                                  const range = formatShiftRange(
                                    assignment.startTime,
                                    assignment.endTime,
                                    assignment.openEnded,
                                  )
                                  const colors =
                                    colorBy === 'client'
                                      ? clientChipColors(
                                          assignment.clientCalendarColor,
                                        )
                                      : null
                                  const statusLabel = colors
                                    ? getStatusMeta({
                                        domain: 'shift',
                                        status:
                                          assignment.shiftStatus as BadgeShiftStatus,
                                      }).label
                                    : ''
                                  return (
                                    <Link
                                      key={assignment.id}
                                      to={`/admin/turnos/${assignment.shiftId}`}
                                      title={`${assignment.siteName} · ${range}`}
                                      style={
                                        colors
                                          ? {
                                              background: colors.background,
                                              color: colors.color,
                                            }
                                          : undefined
                                      }
                                      className={`block min-w-0 rounded px-1 py-1 text-left text-[11px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring ${
                                        colors
                                          ? assignment.shiftStatus ===
                                            'cancelled'
                                            ? 'line-through opacity-70'
                                            : ''
                                          : 'bg-primary-100 text-primary-800 hover:bg-primary-100/80'
                                      }`}
                                    >
                                      <span className="flex items-center gap-1">
                                        {colors && (
                                          <>
                                            <StatusDot
                                              status={assignment.shiftStatus}
                                            />
                                            <span className="sr-only">
                                              {statusLabel}:{' '}
                                            </span>
                                          </>
                                        )}
                                        <span
                                          data-testid="week-chip-site"
                                          className="block min-w-0 truncate"
                                        >
                                          {assignment.siteName}
                                        </span>
                                      </span>
                                      <ShiftRange
                                        startTime={assignment.startTime}
                                        endTime={assignment.endTime}
                                        openEnded={assignment.openEnded}
                                      />
                                    </Link>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Combobox
            aria-label="Elegir empleado"
            placeholder="Elegí un empleado"
            value={mobileEmployee?.profileId}
            onValueChange={setMobileEmployeeId}
            options={employees.map((employee) => ({
              value: employee.profileId,
              label: `${employee.firstName} ${employee.lastName}`,
            }))}
          />
          {mobileEmployee && (
            <Link
              to={`/admin/empleados/${mobileEmployee.profileId}`}
              className="flex min-h-11 items-center text-[13px] font-medium text-primary-800"
            >
              Ver ficha de {mobileEmployee.firstName} {mobileEmployee.lastName}
            </Link>
          )}
          {mobileEmployee && (
            <ul className="flex flex-col gap-2">
              {weekDays.map((day) => {
                const dayAssignments =
                  assignmentsByEmployee
                    .get(mobileEmployee.profileId)
                    ?.get(day) ?? []
                return (
                  <li
                    key={day}
                    className="rounded-lg border border-border bg-surface px-3 py-3"
                  >
                    <p className="text-[12px] font-semibold text-text-3 capitalize">
                      {formatDateOnly(day)}
                    </p>
                    {dayAssignments.length === 0 ? (
                      <p className="text-[13px] text-text-3">Libre</p>
                    ) : (
                      <div className="flex flex-col gap-1 pt-1">
                        {dayAssignments.map((assignment) => {
                          const colors =
                            colorBy === 'client'
                              ? clientChipColors(assignment.clientCalendarColor)
                              : null
                          return (
                            <Link
                              key={assignment.id}
                              to={`/admin/turnos/${assignment.shiftId}`}
                              style={
                                colors
                                  ? {
                                      background: colors.background,
                                      color: colors.color,
                                    }
                                  : undefined
                              }
                              className={`flex min-h-11 items-center gap-2 text-left text-[13px] font-medium ${
                                colors
                                  ? `rounded px-2 ${assignment.shiftStatus === 'cancelled' ? 'line-through opacity-70' : ''}`
                                  : 'text-primary-800'
                              }`}
                            >
                              {colors && (
                                <>
                                  <StatusDot status={assignment.shiftStatus} />
                                  <span className="sr-only">
                                    {
                                      getStatusMeta({
                                        domain: 'shift',
                                        status:
                                          assignment.shiftStatus as BadgeShiftStatus,
                                      }).label
                                    }
                                    :{' '}
                                  </span>
                                </>
                              )}
                              <span>
                                {assignment.siteName} ·{' '}
                                {formatShiftRange(
                                  assignment.startTime,
                                  assignment.endTime,
                                  assignment.openEnded,
                                )}
                              </span>
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {colorBy === 'client' && <StatusDotLegend />}
    </div>
  )
}

export { WeekGrid }
