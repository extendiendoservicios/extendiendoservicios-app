import { useMemo, useState } from 'react'
import { UserCheck } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupervisorStatusQuery } from '@/features/geo/queries'
import {
  buildDayCards,
  buildTodayCards,
  type CoordinatorCardData,
} from '../coordinatorCards'
import { canCorrectWorkdays } from '../permissions'
import { useWorkdaysByDateQuery } from '../queries'
import { CoordinatorActivityPanel } from './CoordinatorActivityPanel'
import { CoordinatorCard } from './CoordinatorCard'
import { EndWorkdayDialog } from './EndWorkdayDialog'

interface CoordinatorCardsProps {
  /** `YYYY-MM-DD`. */
  date: string
  isToday: boolean
  /** Con `true` (Resumen) no se listan los coordinadores que todavía no iniciaron. */
  hideNotStarted?: boolean
  emptyTitle?: string
}

/**
 * Una tarjeta por coordinador (OD-04) con «Ver actividad» (panel lateral) y
 * «Finalizar jornada» (OD-06, `manage_attendance`). La usan el Resumen
 * (ADM-02) y «Asistencia de hoy» (ADM-10). Hoy lee el estado de todos los
 * coordinadores (60 s) y las jornadas del día; otra fecha, solo las jornadas.
 */
function CoordinatorCards({
  date,
  isToday,
  hideNotStarted = false,
  emptyTitle = 'No hay jornadas de coordinadores para este día',
}: CoordinatorCardsProps) {
  const auth = useAuth()
  const canManage = canCorrectWorkdays({
    roles: auth.roles,
    capabilities: auth.capabilities,
  })
  const statusQuery = useSupervisorStatusQuery(isToday)
  const workdaysQuery = useWorkdaysByDateQuery(date, true, isToday)
  const [panelId, setPanelId] = useState<string | null>(null)
  const [endId, setEndId] = useState<string | null>(null)

  const cards = useMemo(() => {
    const built = isToday
      ? buildTodayCards(statusQuery.data ?? [], workdaysQuery.data ?? [])
      : buildDayCards(workdaysQuery.data ?? [])
    return hideNotStarted
      ? built.filter((card) => card.status !== 'not_started')
      : built
  }, [isToday, hideNotStarted, statusQuery.data, workdaysQuery.data])

  const panelCard = cards.find((card) => card.supervisorId === panelId) ?? null
  const endCard = cards.find((card) => card.supervisorId === endId) ?? null
  const isLoading = isToday
    ? statusQuery.isLoading || workdaysQuery.isLoading
    : workdaysQuery.isLoading
  const error = (isToday ? statusQuery.error : null) ?? workdaysQuery.error

  function openEnd(card: CoordinatorCardData) {
    setEndId(card.supervisorId)
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-[13px] text-danger-800">
          {error.message}
        </p>
      )}
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : cards.length === 0 ? (
        <EmptyState icon={UserCheck} title={emptyTitle} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {cards.map((card) => (
            <CoordinatorCard
              key={card.supervisorId}
              card={card}
              canManage={canManage}
              onViewActivity={(selected) => setPanelId(selected.supervisorId)}
              onEndWorkday={openEnd}
            />
          ))}
        </div>
      )}

      <CoordinatorActivityPanel
        card={panelCard}
        canManage={canManage}
        onOpenChange={(open) => {
          if (!open) setPanelId(null)
        }}
        onEndWorkday={openEnd}
      />
      {endCard?.workday && (
        <EndWorkdayDialog
          workdayId={endCard.workday.id}
          supervisorName={endCard.name}
          workDate={endCard.workday.workDate}
          startedAt={endCard.workday.startedAt}
          hasOpenPause={endCard.workday.openPauseEventId != null}
          hasOpenSupervision={endCard.workday.openSupervisionId != null}
          open
          onOpenChange={(open) => {
            if (!open) setEndId(null)
          }}
        />
      )}
    </div>
  )
}

export { CoordinatorCards }
