import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight, ListChecks, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/IconButton'
import { MonthPicker } from '@/components/MonthPicker'
import { Combobox } from '@/components/Combobox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/status'
import type { ShiftStatus as BadgeShiftStatus } from '@/components/status'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useAuth } from '@/features/auth/AuthProvider'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { useEmployeesQuery } from '@/features/employees/queries'
import { useHolidaysQuery } from '@/features/settings/queries'
import {
  useClientFilterOptionsQuery,
  useSitesMapQuery,
} from '@/features/sites/queries'
import {
  canGenerateShifts,
  canManageShiftTime,
} from '@/features/shifts/permissions'
import {
  addMonthsToYearMonth,
  buildMonthGridDays,
  monthRange,
} from '@/features/planning/planningDates'
import { groupShiftsByDate, shiftChipLabel } from '@/features/planning/grouping'
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

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'scheduled', label: 'Programado' },
  { value: 'assigned', label: 'Asignado' },
  { value: 'in_progress', label: 'En curso' },
  { value: 'completed', label: 'Finalizado' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'uncovered', label: 'Sin cubrir' },
]

interface MonthCalendarProps {
  /** Navega a ADM-05 con la fecha elegida (lo resuelve `PlanningPage`, dueña de `?vista=`/`?fecha=`). */
  onOpenDay: (date: string) => void
}

function MonthCalendar({ onOpenDay }: MonthCalendarProps) {
  const auth = useAuth()
  const actor = { roles: auth.roles, capabilities: auth.capabilities }
  const isDesktop = useMediaQuery(DESKTOP_QUERY)

  const today = todayInBuenosAires()
  const [year, setYear] = useState(() => Number(today.slice(0, 4)))
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)))

  const [clientId, setClientId] = useState<string>('all')
  const [siteId, setSiteId] = useState<string>('all')
  const [employeeId, setEmployeeId] = useState<string>('all')
  const [status, setStatus] = useState<string>('all')

  const { from, to } = useMemo(() => monthRange(year, month), [year, month])

  const shiftsQuery = useShiftsBoardRangeQuery(from, to, {
    clientId: clientId !== 'all' ? clientId : undefined,
    siteId: siteId !== 'all' ? siteId : undefined,
    employeeId: employeeId !== 'all' ? employeeId : undefined,
    status: status !== 'all' ? status : undefined,
  })
  const holidaysQuery = useHolidaysQuery(year)
  const clientOptionsQuery = useClientFilterOptionsQuery()
  const sitesQuery = useSitesMapQuery({})
  const employeesQuery = useEmployeesQuery({ role: 'employee' })

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

  const siteOptions = useMemo(
    () =>
      (sitesQuery.data ?? []).filter(
        (site) => clientId === 'all' || site.clientId === clientId,
      ),
    [sitesQuery.data, clientId],
  )

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
        <div className="flex flex-wrap items-center gap-2">
          {canGenerateShifts(actor) && (
            <Button asChild variant="ghost" icon={ListChecks}>
              <Link to="/admin/turnos/generar">Generar turnos del mes</Link>
            </Button>
          )}
          {canManageShiftTime(actor) && (
            <Button asChild icon={Plus}>
              <Link to="/admin/turnos/nuevo">Nuevo turno</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
        <Combobox
          aria-label="Filtrar por empleado"
          placeholder="Todos los empleados"
          className="w-56"
          value={employeeId}
          onValueChange={setEmployeeId}
          options={[
            { value: 'all', label: 'Todos los empleados' },
            ...(employeesQuery.data ?? []).map((option) => ({
              value: option.profileId,
              label: `${option.firstName} ${option.lastName}`,
            })),
          ]}
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filtrar por estado" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
              const isHoliday = holidayDates.has(day.date)
              const isToday = day.date === today
              const visible = dayShifts.slice(0, MAX_CHIPS_PER_DAY)
              const hiddenCount = dayShifts.length - visible.length

              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => onOpenDay(day.date)}
                  className={`flex min-h-28 flex-col gap-1 border-b border-r border-border p-2 text-left align-top outline-none last:border-r-0 hover:bg-bg focus-visible:ring-3 focus-visible:ring-ring ${
                    day.isCurrentMonth ? '' : 'bg-secondary/20 text-text-3'
                  }`}
                >
                  <div className="flex items-center justify-between">
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
                  </div>
                  <div className="flex flex-col gap-1">
                    {visible.map((shift) => (
                      <span
                        key={shift.id}
                        className="truncate rounded bg-secondary/60 px-1.5 py-0.5 text-[10.5px] font-medium"
                      >
                        <StatusBadge
                          domain="shift"
                          status={shift.displayStatus as BadgeShiftStatus}
                          className="mr-1 inline-flex align-middle"
                        />
                        <span className="align-middle">
                          {shiftChipLabel(shift)}
                        </span>
                      </span>
                    ))}
                    {hiddenCount > 0 && (
                      <span className="text-[10.5px] font-semibold text-text-3">
                        +{hiddenCount} más
                      </span>
                    )}
                  </div>
                </button>
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
                    </span>
                  </button>
                </li>
              )
            })}
        </ul>
      )}
    </div>
  )
}

export { MonthCalendar }
