import { useState } from 'react'
import { Link } from 'react-router'
import { Clock, Pause, Plus, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatMinutes, formatTime } from '@/lib/format'
import { formatShortDate } from '@/lib/format'
import {
  WORKDAY_EVENT_LABELS,
  type AdminWorkday,
  type WorkdayEvent,
  type WorkdayEventKind,
} from '@/api/workdaysAdmin'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { SupervisionStateBadges } from '@/features/supervisions/components/UnclosedBadge'
import type { SupervisionStatus } from '@/api/supervisions'
import { AddWorkdayPauseDialog } from './AddWorkdayPauseDialog'
import { CorrectWorkdayEventDialog } from './CorrectWorkdayEventDialog'
import { RemoveWorkdayPauseDialog } from './RemoveWorkdayPauseDialog'

/** Eventos de la jornada que la administración puede corregir (los de supervisión no, `EVENT_NOT_CORRECTABLE`). */
const CORRECTABLE_KINDS = new Set<WorkdayEventKind>([
  'start',
  'pause',
  'resume',
  'end',
  'reopen',
])

const STATE_BADGE = {
  running: { label: 'En curso', variant: 'primary' },
  paused: { label: 'En pausa', variant: 'warning' },
  ended: { label: 'Finalizada', variant: 'neutral' },
} as const

interface WorkdayCardProps {
  workday: AdminWorkday
  /** Corregir (`manage_attendance`): oculta los botones si es falso. */
  canCorrect: boolean
}

/**
 * Una jornada del coordinador en la pestaña “Jornadas” de ADM-16 (P24.3):
 * inicio, fin, horas netas (CJ-13), pausas, supervisiones (duración
 * informativa, CJ-14), la advertencia «Cerrada automáticamente» mientras no
 * se corrija (CJ-31) y el historial de correcciones (CJ-32). Se ve igual a
 * 390 px: una columna de tarjeta.
 */
function WorkdayCard({ workday, canCorrect }: WorkdayCardProps) {
  const [correctTarget, setCorrectTarget] = useState<WorkdayEvent | null>(null)
  const [removePauseId, setRemovePauseId] = useState<string | null>(null)
  const [isAddPauseOpen, setAddPauseOpen] = useState(false)

  const state = STATE_BADGE[workday.state]
  const visibleEvents = workday.events.filter((event) => !event.removed)
  const history = workday.events.filter(
    (event) => event.corrected || event.removed,
  )

  return (
    <article
      aria-label={`Jornada del ${formatDateOnly(workday.workDate)}`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[14px] font-semibold text-text capitalize">
            {formatDateOnly(workday.workDate)}
          </h3>
          <Badge variant={state.variant}>{state.label}</Badge>
          {workday.corrected && <Badge variant="info">Corregida</Badge>}
        </div>
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
          <Clock aria-hidden="true" className="size-4 text-text-3" />
          {formatMinutes(workday.workedMinutes)}
          <span className="text-[11px] font-normal text-text-3">netas</span>
        </p>
      </header>

      {workday.autoCloseWarning && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-warning-bg p-3 text-[12px] text-warning-800"
        >
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          <span>
            <strong>Cerrada automáticamente.</strong> El coordinador no finalizó
            la jornada y se cerró sola a las 23:55. Las horas pueden estar
            infladas: revisá el fin y corregilo si hace falta.
          </span>
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] text-text-2 sm:grid-cols-4">
        <div>
          <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
            Inicio
          </dt>
          <dd>{formatTime(workday.startedAt)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
            Fin
          </dt>
          <dd>{workday.endedAt ? formatTime(workday.endedAt) : '—'}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
            Pausas
          </dt>
          <dd>
            {workday.pauses.length === 0
              ? 'Sin pausas'
              : formatMinutes(workday.pauseMinutes)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
            Supervisiones
          </dt>
          <dd>{workday.supervisionsCount}</dd>
        </div>
      </dl>

      {workday.pauses.length > 0 && (
        <section className="flex flex-col gap-1">
          <h4 className="flex items-center gap-1.5 text-[11.5px] font-semibold text-text-2">
            <Pause aria-hidden="true" className="size-3.5" />
            Pausas
          </h4>
          <ul className="flex flex-col gap-1 text-[12px] text-text-2">
            {workday.pauses.map((pause) => (
              <li key={pause.pauseEventId}>
                {formatTime(pause.startsAt)}
                {' a '}
                {pause.endsAt ? formatTime(pause.endsAt) : 'sin cerrar'}
                {' · '}
                {formatMinutes(pause.minutes)}
                {pause.reason ? ` · ${pause.reason}` : ''}
                {pause.corrected ? ' · corregida' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {workday.supervisions.length > 0 && (
        <section className="flex flex-col gap-1">
          <h4 className="text-[11.5px] font-semibold text-text-2">
            Supervisiones
          </h4>
          <ul className="flex flex-col gap-2">
            {workday.supervisions.map((supervision) => (
              <li
                key={supervision.supervisionId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-[12px]"
              >
                <Link
                  to={`/admin/supervisiones/${supervision.supervisionId}`}
                  className="min-w-0 font-semibold text-text hover:text-primary-800"
                >
                  {supervision.clientName} · {supervision.siteName}
                </Link>
                <span className="flex flex-wrap items-center gap-2 text-text-2">
                  {supervision.checkInAt
                    ? formatTime(supervision.checkInAt)
                    : '—'}
                  {' a '}
                  {supervision.checkOutAt
                    ? formatTime(supervision.checkOutAt)
                    : '—'}
                  {supervision.durationMinutes != null && (
                    <span className="text-text-3">
                      ({formatMinutes(supervision.durationMinutes)},
                      informativa)
                    </span>
                  )}
                  <SupervisionStateBadges
                    status={supervision.status as SupervisionStatus}
                    unclosed={supervision.unclosed}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[11.5px] font-semibold text-text-2">
            Registro de la jornada
          </h4>
          {canCorrect && (
            <Button
              variant="ghost"
              size="sm"
              icon={Plus}
              onClick={() => setAddPauseOpen(true)}
            >
              Agregar pausa
            </Button>
          )}
        </div>
        <ul className="flex flex-col gap-1">
          {visibleEvents.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-2"
            >
              <span>
                <span className="font-semibold text-text tabular-nums">
                  {formatTime(event.recordedAt)}
                </span>{' '}
                {WORKDAY_EVENT_LABELS[event.kind]}
                {event.kind === 'pause' && event.reason
                  ? ` (${event.reason})`
                  : ''}
                {!event.hasPosition && (
                  <span className="text-text-3"> · Sin ubicación</span>
                )}
                {event.corrected && (
                  <span className="text-text-3"> · corregido</span>
                )}
              </span>
              {canCorrect && CORRECTABLE_KINDS.has(event.kind) && (
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Corregir hora: ${WORKDAY_EVENT_LABELS[event.kind].toLowerCase()} de las ${formatTime(event.recordedAt)}`}
                    onClick={() => setCorrectTarget(event)}
                  >
                    Corregir hora
                  </Button>
                  {event.kind === 'pause' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Quitar la pausa de las ${formatTime(event.recordedAt)}`}
                      onClick={() => setRemovePauseId(event.id)}
                    >
                      Quitar pausa
                    </Button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {history.length > 0 && (
        <section className="flex flex-col gap-1">
          <h4 className="text-[11.5px] font-semibold text-text-2">
            Historial de correcciones
          </h4>
          <ul className="flex flex-col gap-1 text-[11.5px] text-text-3">
            {history.map((event) => (
              <li key={event.id}>
                <span className="font-medium text-text-2">
                  {event.removed
                    ? `${WORKDAY_EVENT_LABELS[event.kind]} dada de baja`
                    : `${WORKDAY_EVENT_LABELS[event.kind]}: ${
                        event.correctedFrom
                          ? `antes ${formatShortDate(event.correctedFrom)} ${formatTime(event.correctedFrom)}`
                          : 'corregido'
                      }, ahora ${formatTime(event.recordedAt)}`}
                </span>
                {event.correctionReason
                  ? ` · Motivo: ${event.correctionReason}`
                  : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {correctTarget && (
        <CorrectWorkdayEventDialog
          event={correctTarget}
          workDate={workday.workDate}
          open
          onOpenChange={(open) => {
            if (!open) setCorrectTarget(null)
          }}
        />
      )}
      {removePauseId && (
        <RemoveWorkdayPauseDialog
          pauseEventId={removePauseId}
          open
          onOpenChange={(open) => {
            if (!open) setRemovePauseId(null)
          }}
        />
      )}
      <AddWorkdayPauseDialog
        workdayId={workday.id}
        workDate={workday.workDate}
        open={isAddPauseOpen}
        onOpenChange={setAddPauseOpen}
      />
    </article>
  )
}

export { WorkdayCard }
