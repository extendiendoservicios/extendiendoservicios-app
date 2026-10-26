import { Link } from 'react-router'
import { CalendarClock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/status'
import { formatCalendarDate, formatMinutes, formatTime } from '@/lib/format'
import {
  useMyWorkdaysHistoryQuery,
  type MyWorkday,
  type WorkdaySupervision,
} from '@/api/myWorkdays'
import {
  WORKDAY_BAR_LABELS,
  WORKDAY_BAR_VARIANTS,
  workdayBarState,
} from '@/features/coordinator/workday'

/**
 * SUP-08 · Historial (P24.2, `05` fila SUP-08, CJ-13, CJ-14, CJ-17): las
 * jornadas del coordinador por día, la más reciente primero. Cada una muestra
 * las horas netas (inicio a fin menos las pausas), el horario, las pausas y
 * las supervisiones que hizo ese día. El tiempo de cada supervisión es
 * informativo: no suma horas. Una jornada que se cerró sola a las 23:55
 * lleva su advertencia, y la que la administración corrigió lo dice.
 *
 * Cada supervisión abre su detalle (SUP-04, solo lectura si ya está cerrada).
 */
export default function HistoryPage() {
  const { data, isLoading, isError } = useMyWorkdaysHistoryQuery()

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (isError || !data) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No pudimos cargar tu historial. Probá de nuevo en un momento.
        </AlertDescription>
      </Alert>
    )
  }

  if (data.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Todavía no tenés jornadas"
        description="Cuando inicies tu primera jornada, la vas a ver acá."
        className="mt-4"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {data.map((workday) => (
        <WorkdayRow key={workday.id} workday={workday} />
      ))}
    </div>
  )
}

function WorkdayRow({ workday }: { workday: MyWorkday }) {
  const state = workdayBarState(workday)
  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-text">
              {formatCalendarDate(workday.workDate)}
            </p>
            <p className="text-[12px] text-text-3">
              {formatTime(workday.startedAt)}
              {' a '}
              {workday.endedAt ? formatTime(workday.endedAt) : 'en curso'}
            </p>
          </div>
          <Badge variant={WORKDAY_BAR_VARIANTS[state]} dot>
            {WORKDAY_BAR_LABELS[state]}
          </Badge>
        </div>

        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[18px] font-bold text-text tabular-nums">
            {formatMinutes(workday.workedMinutes)}
          </p>
          <p className="text-[11.5px] text-text-3">
            {workday.pauses.length === 0
              ? 'Sin pausas'
              : `${workday.pauses.length === 1 ? '1 pausa' : `${workday.pauses.length} pausas`} · ${formatMinutes(workday.pauseMinutes)}`}
          </p>
        </div>

        {workday.autoCloseWarning && (
          <p className="text-[11.5px] text-warning-800">
            Se cerró sola porque no la finalizaste. Si el horario no es el
            correcto, pedile a la administración que lo corrija.
          </p>
        )}
        {workday.corrected && (
          <p className="text-[11.5px] text-text-3">
            Corregida por la administración.
          </p>
        )}

        {workday.supervisions.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border pt-2">
            <p className="text-[11px] font-semibold tracking-[0.4px] text-text-3 uppercase">
              Supervisiones
            </p>
            {workday.supervisions.map((supervision) => (
              <SupervisionLine
                key={supervision.supervisionId}
                supervision={supervision}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SupervisionLine({ supervision }: { supervision: WorkdaySupervision }) {
  return (
    <Link
      to={`/sup/supervisiones/${supervision.supervisionId}`}
      className="flex min-h-11 items-center justify-between gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring"
    >
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-text">
          {supervision.clientName} · {supervision.siteName}
        </p>
        <p className="text-[11px] text-text-3">
          {supervision.checkInAt ? formatTime(supervision.checkInAt) : '--:--'}
          {supervision.checkOutAt && ` a ${formatTime(supervision.checkOutAt)}`}
          {supervision.durationMinutes != null &&
            ` · ${formatMinutes(supervision.durationMinutes)}`}
        </p>
      </div>
      {supervision.unclosed ? (
        <Badge variant="warning" dot>
          Sin cerrar
        </Badge>
      ) : (
        <StatusBadge domain="supervision" status={supervision.status} />
      )}
    </Link>
  )
}
