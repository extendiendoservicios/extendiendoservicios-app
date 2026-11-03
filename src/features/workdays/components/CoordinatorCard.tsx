import { Link } from 'react-router'
import { Activity, Square, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatMinutes, formatTime } from '@/lib/format'
import {
  coordinatorWorkdayPath,
  SUPERVISOR_STATUS_LABELS,
  SUPERVISOR_STATUS_VARIANTS,
} from '@/features/geo/coordinators'
import { describePause, type CoordinatorCardData } from '../coordinatorCards'

interface CoordinatorCardProps {
  card: CoordinatorCardData
  /** `manage_attendance`: oculta «Finalizar jornada» si es falso. */
  canManage: boolean
  onViewActivity: (card: CoordinatorCardData) => void
  onEndWorkday: (card: CoordinatorCardData) => void
}

/**
 * Tarjeta de un coordinador en el Resumen y en «Asistencia de hoy» (OD-04):
 * estado (CJ-33), inicio de la jornada, cada pausa con su motivo, la
 * supervisión en curso y las horas netas. «Ver actividad» abre el panel con
 * la línea de tiempo; «Finalizar jornada» (OD-06) solo con la jornada abierta.
 */
function CoordinatorCard({
  card,
  canManage,
  onViewActivity,
  onEndWorkday,
}: CoordinatorCardProps) {
  const workday = card.workday
  return (
    <article
      aria-label={`Coordinador ${card.name}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to={coordinatorWorkdayPath(card.supervisorId)}
          className="min-w-0 text-[14px] font-semibold text-text hover:text-primary-800"
        >
          {card.name}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5">
          {card.onLeave && <Badge variant="neutral">De licencia</Badge>}
          {card.corrected && <Badge variant="info">Corregida</Badge>}
          <Badge variant={SUPERVISOR_STATUS_VARIANTS[card.status]}>
            {SUPERVISOR_STATUS_LABELS[card.status]}
          </Badge>
        </div>
      </header>

      {card.autoCloseWarning && (
        <p className="flex items-center gap-1 text-[12.5px] font-medium text-warning-800">
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          Se cerró sola: revisá el horario de fin
        </p>
      )}

      {card.startedAt ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] text-text-2 sm:grid-cols-4">
          <div>
            <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
              Inicio
            </dt>
            <dd>{formatTime(card.startedAt)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
              Fin
            </dt>
            <dd>{card.endedAt ? formatTime(card.endedAt) : '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
              Horas netas
            </dt>
            <dd className="font-semibold text-text">
              {formatMinutes(card.workedMinutes)}
            </dd>
          </div>
          {card.supervision && (
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
                Supervisando
              </dt>
              <dd>
                {[card.supervision.clientName, card.supervision.siteName]
                  .filter(Boolean)
                  .join(' · ')}
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="text-[12.5px] text-text-3">
          Todavía no inició la jornada.
        </p>
      )}

      {card.pauses.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
            Pausas
          </h4>
          <ul className="text-[12.5px] text-text-2">
            {card.pauses.map((pause) => (
              <li key={pause.pauseEventId}>{describePause(pause)}</li>
            ))}
          </ul>
        </div>
      )}

      {workday && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="ghost"
            icon={Activity}
            aria-label={`Ver actividad de ${card.name}`}
            onClick={() => onViewActivity(card)}
          >
            Ver actividad
          </Button>
          {canManage && workday.isOpen && (
            <Button
              size="sm"
              variant="ghost"
              icon={Square}
              aria-label={`Finalizar la jornada de ${card.name}`}
              onClick={() => onEndWorkday(card)}
            >
              Finalizar jornada
            </Button>
          )}
        </div>
      )}
    </article>
  )
}

export { CoordinatorCard }
