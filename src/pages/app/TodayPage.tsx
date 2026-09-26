import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { Bell, CalendarX, MapPin } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/status'
import { formatCalendarDate } from '@/lib/format'
import { isRelevantChange, type MyDayAssignment } from '@/api/myDay'
import {
  useMarkChangesSeenMutation,
  useMyDayQuery,
} from '@/features/employee/queries'

/**
 * EMP-03 · Hoy (MOB-EMP-002, MOB-EMP-003, `06` sección 10, P-092, P-093):
 * bloque "Cambios desde tu última visita", tarjeta destacada, otros
 * servicios de hoy, próximos 7 días y el estado vacío.
 *
 * `mark_changes_seen` se llama DESPUÉS de que `v_my_day` respondió (y solo
 * una vez por vez que se abre esta pantalla, `markedRef`): si se llamara
 * antes, la propia lectura de esta pantalla podría no traer más
 * `changed_since_last_seen` en `true` y la persona se quedaría sin ver el
 * aviso que vino a buscar (`06` sección 10, comentario de
 * `useMarkChangesSeenMutation`).
 */
export default function TodayPage() {
  const { data, isLoading, isError } = useMyDayQuery()
  const markChangesSeen = useMarkChangesSeenMutation()
  const markedRef = useRef(false)

  useEffect(() => {
    if (data && !markedRef.current) {
      markedRef.current = true
      markChangesSeen.mutate()
    }
    // Solo depende de `data` (una vez que la primera lectura llegó): no
    // hace falta volver a marcar en cada refetch del polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (isError || !data) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No pudimos cargar tu jornada. Probá de nuevo en un momento.
        </AlertDescription>
      </Alert>
    )
  }

  const today = data.filter((a) => a.isToday)
  const upcoming = data.filter((a) => !a.isToday)
  const changes = data.filter(isRelevantChange)
  const featured = pickFeatured(today)
  const others = today.filter((a) => a.assignmentId !== featured?.assignmentId)

  return (
    <div className="flex flex-col gap-4">
      {changes.length > 0 && <ChangesBlock changes={changes} />}

      {today.length === 0 ? (
        <EmptyState
          icon={CalendarX}
          title="No tenés servicios hoy"
          className="mt-4"
        />
      ) : (
        <>
          {featured && <ServiceCard assignment={featured} featured />}
          {others.map((assignment) => (
            <ServiceCard
              key={assignment.assignmentId}
              assignment={assignment}
            />
          ))}
        </>
      )}

      {upcoming.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[11px] font-semibold tracking-[0.4px] text-text-3 uppercase">
            Próximos días
          </p>
          {upcoming.map((assignment) => (
            <UpcomingRow
              key={assignment.assignmentId}
              assignment={assignment}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * La tarjeta destacada (`05` fila EMP-03): el servicio en curso si hay uno;
 * si no, el próximo por empezar; si ya están todos cerrados (finalizados o
 * con ausencia avisada), el último de la lista — para que la tarjeta nunca
 * quede vacía habiendo servicios hoy.
 */
export function pickFeatured(
  today: MyDayAssignment[],
): MyDayAssignment | undefined {
  if (today.length === 0) return undefined
  const inProgress = today.find(
    (a) => a.checkInAt != null && a.checkOutAt == null,
  )
  if (inProgress) return inProgress
  const pending = today.find(
    (a) => a.checkInAt == null && a.status !== 'absence_notified',
  )
  if (pending) return pending
  return today[today.length - 1]
}

function ChangesBlock({ changes }: { changes: MyDayAssignment[] }) {
  return (
    <Alert variant="info">
      <Bell aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <AlertTitle>Cambios desde tu última visita</AlertTitle>
        <AlertDescription>
          <ul className="flex flex-col gap-[2px]">
            {changes.map((assignment) => (
              <li key={assignment.assignmentId}>
                {assignment.siteName} ·{' '}
                {formatCalendarDate(assignment.shiftDate)}
              </li>
            ))}
          </ul>
        </AlertDescription>
      </div>
    </Alert>
  )
}

function ServiceCard({
  assignment,
  featured = false,
}: {
  assignment: MyDayAssignment
  featured?: boolean
}) {
  return (
    <Link to={`/app/servicio/${assignment.assignmentId}`} className="block">
      <Card variant={featured ? 'hero' : 'default'}>
        <CardContent className="flex flex-col gap-[6px]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-text">
                {assignment.clientName}
              </p>
              <p className="truncate text-[12px] text-text-3">
                {assignment.siteName}
              </p>
            </div>
            <StatusBadge domain="assignment" status={assignment.status} />
          </div>
          {assignment.siteAddress && (
            <p className="flex items-center gap-[6px] text-[11.5px] text-text-3">
              <MapPin aria-hidden="true" className="size-[13px] shrink-0" />
              <span className="truncate">{assignment.siteAddress}</span>
            </p>
          )}
          <p className="text-[13px] font-semibold text-text-2">
            {formatTimeOfDay(assignment.startTime)}–
            {formatTimeOfDay(assignment.endTime)}
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}

function UpcomingRow({ assignment }: { assignment: MyDayAssignment }) {
  return (
    <Link
      to={`/app/servicio/${assignment.assignmentId}`}
      className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-[9px]"
    >
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-text">
          {formatCalendarDate(assignment.shiftDate)} · {assignment.siteName}
        </p>
        <p className="truncate text-[11px] text-text-3">
          {formatTimeOfDay(assignment.startTime)}–
          {formatTimeOfDay(assignment.endTime)}
        </p>
      </div>
      <StatusBadge domain="assignment" status={assignment.status} />
    </Link>
  )
}

/**
 * `effective_start_time`/`_end_time` de `v_my_day` son `"HH:MM:SS"` (columna
 * `time`, sin fecha ni zona horaria — ya es la hora de pared del turno, no
 * un instante). `formatTime` (`src/lib/format.ts`) espera una fecha/hora
 * completa y hace una conversión de zona con `@date-fns/tz` que no aplica
 * acá (haría falta inventarle una fecha, y correría el riesgo de un
 * corrimiento de zona en el navegador de quien lo mire, aunque el valor ya
 * es la hora correcta): alcanza con cortar los segundos.
 */
function formatTimeOfDay(time: string): string {
  return time.slice(0, 5)
}
