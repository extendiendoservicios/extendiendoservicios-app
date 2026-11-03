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
  emptyTitle?: string
}

/** Cuántos nombres de «Sin iniciar» se ven antes de «y N más». */
const NOT_STARTED_VISIBLE = 4

/** «Sin iniciar (N): Ana López, Pedro Ruiz…» con «y N más» expandible. */
function NotStartedLine({ cards }: { cards: CoordinatorCardData[] }) {
  const [expanded, setExpanded] = useState(false)
  if (cards.length === 0) return null
  const shown = expanded ? cards : cards.slice(0, NOT_STARTED_VISIBLE)
  const hidden = cards.length - shown.length
  return (
    <p
      data-testid="coordinators-not-started"
      className="text-[13px] text-text-2"
    >
      <span className="font-semibold">Sin iniciar ({cards.length}):</span>{' '}
      {shown
        .map((card) =>
          card.onLeave ? `${card.name} (de licencia)` : card.name,
        )
        .join(', ')}
      {hidden > 0 && (
        <>
          {' '}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="font-medium text-primary-800 hover:underline max-md:min-h-11"
          >
            y {hidden} más
          </button>
        </>
      )}
      {expanded && cards.length > NOT_STARTED_VISIBLE && (
        <>
          {' '}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="font-medium text-primary-800 hover:underline max-md:min-h-11"
          >
            ver menos
          </button>
        </>
      )}
    </p>
  )
}

/**
 * Una tarjeta por coordinador con jornada (OD-04) con «Ver actividad» (panel lateral) y
 * «Finalizar jornada» (OD-06, `manage_attendance`). La usan el Resumen
 * (ADM-02) y «Asistencia de hoy» (ADM-10). Hoy lee el estado de todos los
 * coordinadores (60 s) y las jornadas del día; otra fecha, solo las jornadas.
 */
function CoordinatorCards({
  date,
  isToday,
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

  // P27.10b: tarjeta solo para quien tiene jornada; los «Sin iniciar» van en
  // una línea compacta para que el bloque no crezca con cada coordinador.
  const { cards, notStarted } = useMemo(() => {
    const built = isToday
      ? buildTodayCards(statusQuery.data ?? [], workdaysQuery.data ?? [])
      : buildDayCards(workdaysQuery.data ?? [])
    return {
      cards: built.filter((card) => card.status !== 'not_started'),
      notStarted: built.filter((card) => card.status === 'not_started'),
    }
  }, [isToday, statusQuery.data, workdaysQuery.data])

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
      ) : cards.length === 0 && notStarted.length === 0 ? (
        <EmptyState icon={UserCheck} title={emptyTitle} />
      ) : (
        <>
          {cards.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {cards.map((card) => (
                <CoordinatorCard
                  key={card.supervisorId}
                  card={card}
                  canManage={canManage}
                  onViewActivity={(selected) =>
                    setPanelId(selected.supervisorId)
                  }
                  onEndWorkday={openEnd}
                />
              ))}
            </div>
          )}
          <NotStartedLine cards={notStarted} />
        </>
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
