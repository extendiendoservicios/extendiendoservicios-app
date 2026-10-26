import { useMemo, useState } from 'react'
import { CalendarClock, FilePlus } from 'lucide-react'
import { endOfMonth, startOfMonth } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { MonthPicker } from '@/components/MonthPicker'
import { formatMinutes } from '@/lib/format'
import { useAuth } from '@/features/auth/AuthProvider'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import { canCorrectWorkdays } from '../permissions'
import { useSupervisorWorkdaysQuery } from '../queries'
import { RecordWorkdayDialog } from './RecordWorkdayDialog'
import { WorkdayCard } from './WorkdayCard'

interface SupervisorWorkdaysTabProps {
  /** `profile_id` del coordinador. */
  profileId: string
  name: string
}

/**
 * Pestaña «Jornadas» de ADM-16 (P24.3, CJ-13, CJ-17 y CJ-32): cada día del
 * período con su inicio, fin, pausas, horas netas, supervisiones y la
 * advertencia «Cerrada automáticamente». Corregir pide `manage_attendance`.
 * El selector de período es un mes; la ficha imprimible con su propio
 * período es de P24.4.
 */
function SupervisorWorkdaysTab({
  profileId,
  name,
}: SupervisorWorkdaysTabProps) {
  const auth = useAuth()
  const canCorrect = canCorrectWorkdays({
    roles: auth.roles,
    capabilities: auth.capabilities,
  })
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [isRecordOpen, setRecordOpen] = useState(false)

  const filters = useMemo(
    () => ({
      supervisorId: profileId,
      dateFrom: localDateToIsoDate(startOfMonth(month)),
      dateTo: localDateToIsoDate(endOfMonth(month)),
    }),
    [profileId, month],
  )
  const workdaysQuery = useSupervisorWorkdaysQuery(filters)
  const workdays = workdaysQuery.data ?? []
  const totalMinutes = workdays.reduce(
    (sum, workday) => sum + workday.workedMinutes,
    0,
  )
  const warnings = workdays.filter((workday) => workday.autoCloseWarning).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker
          aria-label="Mes de las jornadas"
          value={month}
          onValueChange={(next) => setMonth(startOfMonth(next))}
          className="w-52"
        />
        {canCorrect && (
          <Button
            size="sm"
            variant="ghost"
            icon={FilePlus}
            onClick={() => setRecordOpen(true)}
          >
            Registrar jornada
          </Button>
        )}
      </div>

      {workdays.length > 0 && (
        <p className="rounded-lg border border-border bg-surface-2 p-3 text-[12px] text-text-2">
          <strong className="text-text">{formatMinutes(totalMinutes)}</strong>{' '}
          netas en {workdays.length}{' '}
          {workdays.length === 1 ? 'jornada' : 'jornadas'}. Las horas de la
          jornada van de inicio a fin sin las pausas e incluyen los viajes entre
          sedes; el tiempo de cada supervisión es informativo.
          {warnings > 0 &&
            ` ${warnings === 1 ? 'Una jornada se cerró sola' : `${warnings} jornadas se cerraron solas`} y todavía no se corrigió.`}
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
          title="No hay jornadas en este mes"
          description="Cuando el coordinador inicie su jornada desde el celular, la vas a ver acá."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {workdays.map((workday) => (
            <WorkdayCard
              key={workday.id}
              workday={workday}
              canCorrect={canCorrect}
            />
          ))}
        </div>
      )}

      <RecordWorkdayDialog
        supervisorId={profileId}
        supervisorName={name}
        open={isRecordOpen}
        onOpenChange={setRecordOpen}
      />
    </div>
  )
}

export { SupervisorWorkdaysTab }
