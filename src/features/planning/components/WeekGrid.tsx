import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { groupAssignmentsByEmployeeAndDate } from '@/features/planning/grouping'
import { useAssignmentsBoardRangeQuery } from '@/features/planning/queries'
import { formatDateOnly } from '@/features/settings/dateOnly'

const DESKTOP_QUERY = '(min-width: 1024px)'

/**
 * ADM-04 "Planificación · semana por empleado" (ASSIGN-009, `05` línea 38):
 * grilla empleados × 7 días, una tarjeta por asignación con sede y franja
 * (la propia si la tiene, `effective_start_time`/`effective_end_time` de
 * `v_assignments_board`); celdas vacías "libre"; empleados de licencia
 * atenuados. Filtros cliente, sede, texto. Semana anterior y siguiente.
 * Sin arrastre (P-055, módulo G).
 *
 * Cada tarjeta es un enlace directo a `/admin/turnos/:id` (ADM-06,
 * ASSIGN-011).
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
    },
  )
  const assignmentsByEmployee = useMemo(
    () => groupAssignmentsByEmployeeAndDate(assignmentsQuery.data ?? []),
    [assignmentsQuery.data],
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
    <div className="flex flex-col gap-4">
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
      </div>

      {isDesktop ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border bg-secondary/40 text-left text-[11px] font-semibold text-text-3">
                <th className="min-w-40 px-3 py-2">Empleado</th>
                {weekDays.map((day) => (
                  <th key={day} className="min-w-36 px-3 py-2 capitalize">
                    {formatDateOnly(day)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => {
                const byDate = assignmentsByEmployee.get(employee.profileId)
                const onLeave = employee.effectiveStatus === 'on_leave'
                return (
                  <tr
                    key={employee.profileId}
                    className={`border-b border-border last:border-b-0 ${onLeave ? 'opacity-50' : ''}`}
                  >
                    <td className="px-3 py-2 font-semibold text-text">
                      {employee.firstName} {employee.lastName}
                      {onLeave && (
                        <span className="ml-1 text-[10.5px] font-medium text-text-3">
                          (de licencia)
                        </span>
                      )}
                    </td>
                    {weekDays.map((day) => {
                      const dayAssignments = byDate?.get(day) ?? []
                      return (
                        <td key={day} className="px-3 py-2 align-top">
                          {dayAssignments.length === 0 ? (
                            <span className="text-text-3">Libre</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {dayAssignments.map((assignment) => (
                                <Link
                                  key={assignment.id}
                                  to={`/admin/turnos/${assignment.shiftId}`}
                                  className="rounded bg-primary-100 px-1.5 py-1 text-left text-[11px] font-medium text-primary-800 outline-none hover:bg-primary-100/80 focus-visible:ring-3 focus-visible:ring-ring"
                                >
                                  {assignment.siteName}
                                  <br />
                                  {assignment.startTime.slice(0, 5)}–
                                  {assignment.endTime.slice(0, 5)}
                                </Link>
                              ))}
                            </div>
                          )}
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
                        {dayAssignments.map((assignment) => (
                          <Link
                            key={assignment.id}
                            to={`/admin/turnos/${assignment.shiftId}`}
                            className="text-left text-[13px] font-medium text-primary-800"
                          >
                            {assignment.siteName} ·{' '}
                            {assignment.startTime.slice(0, 5)}–
                            {assignment.endTime.slice(0, 5)}
                          </Link>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export { WeekGrid }
