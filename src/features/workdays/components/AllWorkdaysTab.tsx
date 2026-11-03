import { useMemo, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { endOfMonth, startOfMonth } from 'date-fns'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DatePicker } from '@/components/DatePicker'
import { EmptyState } from '@/components/EmptyState'
import { formatMinutes } from '@/lib/format'
import type { WorkdayListFilterStatus } from '@/api/workdaysAdmin'
import { useAuth } from '@/features/auth/AuthProvider'
import { useEmployeesQuery } from '@/features/employees/queries'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import { UpdatedAgo } from '@/features/supervisions/components/UpdatedAgo'
import { canCorrectWorkdays } from '../permissions'
import { useAllWorkdaysQuery } from '../queries'
import { WorkdayCard } from './WorkdayCard'

/** Estados del filtro (OD-05); «corregida» filtra por `corrected = true`. */
export const WORKDAY_STATUS_FILTER_LABELS: Record<
  WorkdayListFilterStatus,
  string
> = {
  all: 'Todos los estados',
  open: 'Abierta',
  closed: 'Cerrada',
  auto_closed: 'Cerrada automáticamente',
  corrected: 'Corregida',
}

function isoDateToDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

/**
 * Pestaña «Jornadas» de Supervisiones (ADM-14, OD-05): las jornadas de todos
 * los coordinadores con filtros de período (por defecto, el mes en curso),
 * coordinador y estado. El detalle de cada jornada es `WorkdayCard`, el mismo
 * componente de la pestaña «Jornadas» de la ficha del coordinador (P24.3), con
 * las mismas acciones (finalizar y corregir, solo con `manage_attendance`).
 * Se refresca cada 60 s.
 */
function AllWorkdaysTab() {
  const auth = useAuth()
  const canCorrect = canCorrectWorkdays({
    roles: auth.roles,
    capabilities: auth.capabilities,
  })
  const [dateFrom, setDateFrom] = useState(() =>
    localDateToIsoDate(startOfMonth(new Date())),
  )
  const [dateTo, setDateTo] = useState(() =>
    localDateToIsoDate(endOfMonth(new Date())),
  )
  const [supervisorId, setSupervisorId] = useState('all')
  const [status, setStatus] = useState<WorkdayListFilterStatus>('all')

  const filters = useMemo(
    () => ({
      supervisorId: supervisorId === 'all' ? undefined : supervisorId,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      status,
    }),
    [supervisorId, dateFrom, dateTo, status],
  )
  const workdaysQuery = useAllWorkdaysQuery(filters)
  const coordinatorsQuery = useEmployeesQuery({
    role: 'supervisor',
    status: 'all',
  })
  const workdays = workdaysQuery.data ?? []
  const coordinatorOptions = (coordinatorsQuery.data ?? []).map((employee) => ({
    id: employee.profileId,
    name: `${employee.firstName} ${employee.lastName}`,
  }))
  const totalMinutes = workdays.reduce(
    (sum, workday) => sum + workday.workedMinutes,
    0,
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-text-2">Desde</span>
            <DatePicker
              aria-label="Desde"
              value={dateFrom ? isoDateToDate(dateFrom) : undefined}
              onValueChange={(next) =>
                setDateFrom(next ? localDateToIsoDate(next) : '')
              }
              className="w-44"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-text-2">Hasta</span>
            <DatePicker
              aria-label="Hasta"
              value={dateTo ? isoDateToDate(dateTo) : undefined}
              onValueChange={(next) =>
                setDateTo(next ? localDateToIsoDate(next) : '')
              }
              className="w-44"
            />
          </div>
          <Select value={supervisorId} onValueChange={setSupervisorId}>
            <SelectTrigger
              aria-label="Filtrar por coordinador"
              className="w-52"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los coordinadores</SelectItem>
              {coordinatorOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(value) =>
              setStatus(value as WorkdayListFilterStatus)
            }
          >
            <SelectTrigger aria-label="Filtrar por estado" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(WORKDAY_STATUS_FILTER_LABELS).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        {workdaysQuery.dataUpdatedAt > 0 && (
          <UpdatedAgo dataUpdatedAt={workdaysQuery.dataUpdatedAt} />
        )}
      </div>

      {workdaysQuery.error && (
        <p role="alert" className="text-[13px] text-danger-800">
          {workdaysQuery.error.message}
        </p>
      )}

      {workdays.length > 0 && (
        <p className="rounded-lg border border-border bg-surface-2 p-3 text-[12px] text-text-2">
          <strong className="text-text">{formatMinutes(totalMinutes)}</strong>{' '}
          netas en {workdays.length}{' '}
          {workdays.length === 1 ? 'jornada' : 'jornadas'}. Las horas van de
          inicio a fin sin las pausas; el tiempo de cada supervisión es
          informativo.
        </p>
      )}

      {workdaysQuery.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : workdays.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No hay jornadas para mostrar con estos filtros"
          description="Probá con otro período, otro coordinador u otro estado."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {workdays.map((workday) => (
            <WorkdayCard
              key={workday.id}
              workday={workday}
              canCorrect={canCorrect}
              showSupervisor
            />
          ))}
        </div>
      )}
    </div>
  )
}

export { AllWorkdaysTab }
