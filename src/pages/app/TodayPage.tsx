import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, Bell, CalendarX, MapPin } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EmptyState } from '@/components/EmptyState'
import { AssignmentStatusBadge } from '@/features/employee/components/AssignmentStatusBadge'
import { formatCalendarDate } from '@/lib/format'
import { isRelevantChange, type MyDayAssignment } from '@/api/myDay'
import { getNoticeMessage } from '@/features/employee/notice'
import { useNow } from '@/features/employee/useNow'
import { isNotifiable } from '@/features/employee/notifyCandidates'
import {
  useMarkChangesSeenMutation,
  useMyDayQuery,
} from '@/features/employee/queries'
import { OnTheWayAction } from '@/features/employee/components/OnTheWayAction'
import { InstallBanner } from '@/components/InstallBanner'
import { AnnouncementsBanner } from '@/features/announcements/mobile/AnnouncementsBanner'
import { formatAssignmentRange } from '@/features/employee/shiftRange'

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
  const canNotify = data.some(isNotifiable)

  return (
    <div className="flex flex-col gap-4">
      <AnnouncementsBanner />
      <InstallBanner />
      {changes.length > 0 && <ChangesBlock changes={changes} />}

      {/* EMP-12 (MOB-EMP-020): acceso desde Hoy, visible mientras haya al
          menos un servicio que todavía se pueda avisar (sin inicio
          registrado, sin ausencia ya avisada — `isNotifiable`). */}
      {canNotify && (
        <Link
          to="/app/avisar"
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-[12.5px] font-semibold text-primary-800"
        >
          <AlertTriangle aria-hidden="true" className="size-[15px]" />
          Avisar demora o ausencia
        </Link>
      )}

      {today.length === 0 ? (
        <EmptyState
          icon={CalendarX}
          title="No tenés servicios hoy"
          className="mt-4"
        />
      ) : (
        <>
          {featured && (
            <div className="flex flex-col gap-2">
              <ServiceCard assignment={featured} featured />
              <OnTheWayAction assignment={featured} />
            </div>
          )}
          {others.map((assignment) => (
            <div key={assignment.assignmentId} className="flex flex-col gap-2">
              <ServiceCard assignment={assignment} />
              <OnTheWayAction assignment={assignment} />
            </div>
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
 * quede vacía habiendo servicios hoy. Los turnos cancelados no se destacan.
 */
export function pickFeatured(
  today: MyDayAssignment[],
): MyDayAssignment | undefined {
  // Un turno cancelado nunca se destaca (CB-03): se lista como cualquier otro.
  const active = today.filter((a) => a.shiftStatus !== 'cancelled')
  if (active.length === 0) return undefined
  const inProgress = active.find(
    (a) => a.checkInAt != null && a.checkOutAt == null && !a.noCheckout,
  )
  if (inProgress) return inProgress
  const pending = active.find(
    (a) => a.checkInAt == null && a.status !== 'absence_notified',
  )
  if (pending) return pending
  return active[active.length - 1]
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
  const cancelled = assignment.shiftStatus === 'cancelled'
  // Reloj solo para la UI: la tarjeta se actualiza sola al vencer el aviso.
  const now = useNow(30_000)
  const notice = cancelled ? null : getNoticeMessage(assignment, now)
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
            <AssignmentBadge assignment={assignment} />
          </div>
          {assignment.siteAddress && (
            <p className="flex items-center gap-[6px] text-[11.5px] text-text-3">
              <MapPin aria-hidden="true" className="size-[13px] shrink-0" />
              <span className="truncate">{assignment.siteAddress}</span>
            </p>
          )}
          <p className="text-[13px] font-semibold text-text-2">
            {formatAssignmentRange(assignment)}
          </p>
          {notice && (
            <p className="text-[11.5px] font-semibold text-warning-800">
              {notice.text}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}

/** Un turno cancelado se muestra como "Cancelado" (CB-03) y uno sin salida como "Sin salida" (AJ2-09). */
function AssignmentBadge({ assignment }: { assignment: MyDayAssignment }) {
  return <AssignmentStatusBadge assignment={assignment} />
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
          {formatAssignmentRange(assignment)}
        </p>
      </div>
      <AssignmentBadge assignment={assignment} />
    </Link>
  )
}
