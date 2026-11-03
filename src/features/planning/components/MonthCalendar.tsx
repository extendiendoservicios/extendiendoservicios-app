import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@/components/IconButton'
import { MonthPicker } from '@/components/MonthPicker'
import { getStatusMeta } from '@/components/status'
import type { ShiftStatus as BadgeShiftStatus } from '@/components/status'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { useLeavesInRangeQuery } from '@/features/employees/queries'
import { useHolidaysQuery } from '@/features/settings/queries'
import {
  addMonthsToYearMonth,
  buildMonthGridDays,
  monthRange,
} from '@/features/planning/planningDates'
import {
  groupShiftsByDate,
  legendClientsOf,
  shiftChipLabel,
} from '@/features/planning/grouping'
import { useColorBy } from '@/features/planning/colorBy'
import {
  describeCalendarFilters,
  leaveEmployeesByDate,
  leaveSummaryLabel,
  toBoardFilters,
  visibleLeaves,
} from '@/features/planning/calendarFilters'
import { useCalendarFilters } from '@/features/planning/useCalendarFilters'
import {
  CalendarFiltersBar,
  useCalendarFilterOptions,
} from '@/features/planning/components/CalendarFiltersBar'
import { CalendarPrintButton } from '@/features/planning/components/CalendarPrintButton'
import { MonthPrint } from '@/features/planning/components/CalendarPrintViews'
import { ColorByToggle } from '@/features/planning/components/ColorByToggle'
import { ShiftChip } from '@/features/planning/components/ShiftChip'
import {
  ClientLegend,
  StatusDotLegend,
} from '@/features/planning/components/ColorLegends'
import { useShiftsBoardRangeQuery } from '@/features/planning/queries'

/**
 * ADM-03 "Planificación · mes" (ASSIGN-008, `05` línea 37): calendario de 7
 * columnas con chips por turno, feriados marcados, contador por día,
 * filtros (cliente, sede, empleado, estado) y selector de mes sin límite de
 * horizonte (P-054). Debajo de 1024 px (`05` sección 7: "Calendario mensual
 * → lista de días con conteo, D02 no cabe") se muestra como una lista de
 * días en vez de la grilla.
 *
 * Máximo 3 chips visibles por día (con "+n más" si hay más): un mes con 600
 * turnos reparte en promedio 20 por día -- mostrarlos todos en la grilla
 * arruinaría el criterio de rendimiento de F11 ("mes con 600 turnos en
 * menos de 1 s") sin aportar nada que la lista del día (ADM-05, a un clic)
 * no muestre mejor. Decisión propia, documentada en el reporte del encargo.
 */
const MAX_CHIPS_PER_DAY = 3
const DESKTOP_QUERY = '(min-width: 1024px)'
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

interface MonthCalendarProps {
  /** Navega a ADM-05 con la fecha elegida (lo resuelve `PlanningPage`, dueña de `?vista=`/`?fecha=`). */
  onOpenDay: (date: string) => void
}

function MonthCalendar({ onOpenDay }: MonthCalendarProps) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY)

  const today = todayInBuenosAires()
  const [year, setYear] = useState(() => Number(today.slice(0, 4)))
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)))

  // OD-12: los filtros viven en la URL y son los mismos en mes, semana y día.
  const [filters, setFilters] = useCalendarFilters()
  const [colorBy, setColorBy] = useColorBy()

  const { from, to } = useMemo(() => monthRange(year, month), [year, month])

  const shiftsQuery = useShiftsBoardRangeQuery(
    from,
    to,
    toBoardFilters(filters),
  )
  // La leyenda lista todos los clientes del rango aunque el calendario esté
  // filtrado por uno: sin cliente en la clave es la misma consulta de arriba
  // cuando no hay filtro (react-query la comparte) y una aparte si lo hay.
  const legendQuery = useShiftsBoardRangeQuery(
    from,
    to,
    { ...toBoardFilters(filters), clientId: undefined },
    colorBy === 'client',
  )
  const legendClients = useMemo(
    () => legendClientsOf(legendQuery.data ?? []),
    [legendQuery.data],
  )
  const holidaysQuery = useHolidaysQuery(year)
  const { employeeOptions, names: filterNames } =
    useCalendarFilterOptions(filters)

  const holidayDates = useMemo(
    () =>
      new Set(
        (holidaysQuery.data ?? [])
          .filter((holiday) => !holiday.deletedAt)
          .map((holiday) => holiday.holidayDate),
      ),
    [holidaysQuery.data],
  )
  const shiftsByDate = useMemo(
    () => groupShiftsByDate(shiftsQuery.data ?? []),
    [shiftsQuery.data],
  )
  const gridDays = useMemo(() => buildMonthGridDays(year, month), [year, month])

  // OD-14: licencias del mes en pantalla (incluye los días de las semanas
  // vecinas que completan la grilla).
  const leavesQuery = useLeavesInRangeQuery(
    gridDays[0]?.date,
    gridDays[gridDays.length - 1]?.date,
  )
  const leaveNamesByDate = useMemo(() => {
    const nameOf = new Map(
      (employeeOptions ?? []).map((employee) => [
        employee.profileId,
        `${employee.firstName} ${employee.lastName}`,
      ]),
    )
    const byDate = leaveEmployeesByDate(
      visibleLeaves(leavesQuery.data ?? [], filters),
      gridDays.map((day) => day.date),
    )
    return new Map(
      [...byDate].map(([date, ids]) => [
        date,
        ids.map((id) => nameOf.get(id) ?? 'Empleado'),
      ]),
    )
  }, [leavesQuery.data, filters, gridDays, employeeOptions])

  function goToMonth(nextYear: number, nextMonth: number) {
    setYear(nextYear)
    setMonth(nextMonth)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <IconButton
            icon={ChevronLeft}
            aria-label="Mes anterior"
            onClick={() => {
              const prev = addMonthsToYearMonth(year, month, -1)
              goToMonth(prev.year, prev.month)
            }}
          />
          <MonthPicker
            aria-label="Elegir mes"
            value={new Date(year, month - 1, 1)}
            onValueChange={(date) =>
              goToMonth(date.getFullYear(), date.getMonth() + 1)
            }
            className="w-44"
          />
          <IconButton
            icon={ChevronRight}
            aria-label="Mes siguiente"
            onClick={() => {
              const next = addMonthsToYearMonth(year, month, 1)
              goToMonth(next.year, next.month)
            }}
          />
        </div>
      </div>

      <CalendarFiltersBar
        filters={filters}
        onChange={setFilters}
        trailing={
          <>
            <ColorByToggle value={colorBy} onValueChange={setColorBy} />
            <CalendarPrintButton
              title={`Calendario · ${format(new Date(year, month - 1, 1), 'MMMM yyyy', { locale: es })}`}
              filterLines={describeCalendarFilters(filters, filterNames)}
            >
              <MonthPrint
                gridDays={gridDays}
                shiftsByDate={shiftsByDate}
                leaveNamesByDate={leaveNamesByDate}
                holidayDates={holidayDates}
                colorBy={colorBy}
              />
            </CalendarPrintButton>
          </>
        }
      />

      {colorBy === 'client' && (
        <ClientLegend
          title="Clientes del mes"
          clients={legendClients}
          selectedId={filters.clientId !== 'all' ? filters.clientId : null}
          onSelect={(id) => setFilters({ clientId: id ?? 'all' })}
        />
      )}

      {isDesktop ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-7 border-b border-border bg-secondary/40 text-[11px] font-semibold text-text-3">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="px-2 py-2">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {gridDays.map((day) => {
              const dayShifts = shiftsByDate.get(day.date) ?? []
              const dayLeaves = leaveNamesByDate.get(day.date) ?? []
              const isHoliday = holidayDates.has(day.date)
              const isToday = day.date === today
              const visible = dayShifts.slice(0, MAX_CHIPS_PER_DAY)
              const hiddenCount = dayShifts.length - visible.length

              return (
                <div
                  key={day.date}
                  className={`flex min-h-28 flex-col gap-1 border-b border-r border-border p-2 align-top last:border-r-0 ${
                    day.isCurrentMonth ? '' : 'bg-secondary/20 text-text-3'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onOpenDay(day.date)}
                    className="flex items-center justify-between rounded outline-none focus-visible:ring-3 focus-visible:ring-ring"
                  >
                    <span
                      className={`text-[12.5px] font-semibold ${isToday ? 'rounded-full bg-primary px-[7px] py-[1px] text-white' : ''}`}
                    >
                      {Number(day.date.slice(8, 10))}
                    </span>
                    {isHoliday && (
                      <span className="text-[10px] font-semibold text-warning-800">
                        Feriado
                      </span>
                    )}
                    {dayShifts.length > 0 && (
                      <span className="text-[10px] font-semibold text-text-3">
                        {dayShifts.length}
                      </span>
                    )}
                  </button>
                  <div className="flex flex-col gap-1">
                    {visible.map((shift) => {
                      // `05` ADM-03: el chip dice cliente · sede · franja y el
                      // estado va en el color. Una insignia completa adentro
                      // ocupaba todo el ancho de la celda y cortaba el texto.
                      // Cada chip es un enlace directo al turno (ADM-06,
                      // ASSIGN-011): el número de día de arriba sigue abriendo
                      // la lista del día completa (ADM-05).
                      const meta = getStatusMeta({
                        domain: 'shift',
                        status: shift.displayStatus as BadgeShiftStatus,
                      })
                      const label = shiftChipLabel(shift)
                      return (
                        <Link
                          key={shift.id}
                          to={`/admin/turnos/${shift.id}`}
                          title={`${meta.label} · ${label}`}
                          className="block w-full min-w-0 truncate rounded outline-none focus-visible:ring-3 focus-visible:ring-ring"
                        >
                          <ShiftChip
                            label={label}
                            displayStatus={shift.displayStatus}
                            clientCalendarColor={shift.clientCalendarColor}
                            colorBy={colorBy}
                          />
                        </Link>
                      )
                    })}
                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        onClick={() => onOpenDay(day.date)}
                        className="text-left text-[10.5px] font-semibold text-text-3 outline-none focus-visible:ring-3 focus-visible:ring-ring"
                      >
                        +{hiddenCount} más
                      </button>
                    )}
                    {dayLeaves.length > 0 && (
                      <span
                        data-testid="leave-chip"
                        title={`De licencia: ${dayLeaves.join(', ')}`}
                        className="block w-full min-w-0 truncate rounded border border-dashed border-border-strong bg-secondary px-1.5 py-0.5 text-[10.5px] font-medium text-text-2"
                      >
                        {leaveSummaryLabel(dayLeaves)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {gridDays
            .filter((day) => day.isCurrentMonth)
            .map((day) => {
              const dayShifts = shiftsByDate.get(day.date) ?? []
              const dayLeaves = leaveNamesByDate.get(day.date) ?? []
              const isHoliday = holidayDates.has(day.date)
              return (
                <li key={day.date}>
                  <button
                    type="button"
                    onClick={() => onOpenDay(day.date)}
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring"
                  >
                    <span className="text-[13px] font-semibold text-text">
                      {day.date === today ? 'Hoy · ' : ''}
                      {day.date.slice(8, 10)}/{day.date.slice(5, 7)}
                      {isHoliday ? ' · Feriado' : ''}
                    </span>
                    <span className="text-[12px] text-text-3">
                      {dayShifts.length} turno
                      {dayShifts.length === 1 ? '' : 's'}
                      {dayLeaves.length > 0 &&
                        ` · ${leaveSummaryLabel(dayLeaves)}`}
                    </span>
                  </button>
                </li>
              )
            })}
        </ul>
      )}

      {colorBy === 'client' && <StatusDotLegend />}
    </div>
  )
}

export { MonthCalendar }
