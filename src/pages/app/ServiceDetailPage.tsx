import { useParams } from 'react-router'
import { Camera, MapPin, Navigation, Phone, PhoneOff } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { PersonCell } from '@/components/PersonCell'
import { TaskList } from '@/components/TaskList'
import { StatusBadge } from '@/components/status'
import { formatMinutes } from '@/lib/format'
import { avatarUrl } from '@/lib/avatarUrl'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  useMyDayQuery,
  useShiftPeersQuery,
  useShiftTasksReadOnlyQuery,
} from '@/features/employee/queries'

/**
 * EMP-04 · Detalle del servicio (MOB-EMP-004, `05` fila EMP-04): cliente,
 * sede, dirección (enlace a mapas), horario y duración, compañeros del
 * turno, instrucciones de acceso, restricciones, contacto de la sede,
 * tareas previstas (solo lectura: EMP-08, la pantalla que las deja marcar,
 * es de P13.3) y estado propio.
 *
 * La asignación sale de la caché de `useMyDayQuery` (mismo `assignmentId`
 * que ya trajo EMP-03): `v_my_day` ya está acotada a "mis" asignaciones de
 * hoy y los próximos 7 días (P-093), así que no hace falta una consulta
 * aparte solo para el detalle — evita mantener dos formas de leer la misma
 * fila.
 */
export default function ServiceDetailPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const auth = useAuth()
  const { data: myDay, isLoading } = useMyDayQuery()
  const assignment = myDay?.find((a) => a.assignmentId === assignmentId)

  const { data: peers } = useShiftPeersQuery(
    assignment?.shiftId ?? '',
    auth.userId ?? '',
  )
  const { data: tasks } = useShiftTasksReadOnlyQuery(assignment?.shiftId ?? '')

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (!assignment) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No encontramos ese servicio. Volvé a Hoy e intentá de nuevo.
        </AlertDescription>
      </Alert>
    )
  }

  const mapsHref = assignment.siteAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${assignment.siteName} ${assignment.siteAddress}`,
      )}`
    : null
  const telHref = assignment.siteContactPhone
    ? `tel:${assignment.siteContactPhone.replace(/[^0-9+]/g, '')}`
    : null
  const durationMinutes = minutesBetween(
    assignment.startTime,
    assignment.endTime,
  )

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="items-start justify-between">
          <div className="min-w-0">
            <CardTitle>{assignment.clientName}</CardTitle>
            <p className="text-[12px] text-text-3">{assignment.siteName}</p>
          </div>
          <StatusBadge domain="assignment" status={assignment.status} />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {assignment.siteAddress && (
            <a
              href={mapsHref ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-[13px] font-medium text-primary underline-offset-2 hover:underline"
            >
              <MapPin aria-hidden="true" className="size-4 shrink-0" />
              {assignment.siteAddress}
              <Navigation
                aria-hidden="true"
                className="ml-auto size-4 shrink-0"
              />
            </a>
          )}
          <p className="text-[13px] text-text-2">
            {formatTimeOfDay(assignment.startTime)}–
            {formatTimeOfDay(assignment.endTime)}
            {durationMinutes != null && (
              <span className="text-text-3">
                {' '}
                · {formatMinutes(durationMinutes)}
              </span>
            )}
          </p>
          {assignment.buildingHours && (
            <p className="text-[11.5px] text-text-3">
              Horario del edificio: {assignment.buildingHours}
            </p>
          )}
          {(assignment.phoneRestricted || assignment.photosNotAllowed) && (
            <div className="flex flex-wrap gap-2">
              {assignment.phoneRestricted && (
                <Badge variant="warning">
                  <PhoneOff aria-hidden="true" className="size-3" />
                  Uso de teléfono restringido
                </Badge>
              )}
              {assignment.photosNotAllowed && (
                <Badge variant="warning">
                  <Camera aria-hidden="true" className="size-3" />
                  No se permiten fotos
                </Badge>
              )}
            </div>
          )}
          {assignment.restrictionsNotes && (
            <p className="text-[11.5px] text-text-3">
              {assignment.restrictionsNotes}
            </p>
          )}
        </CardContent>
      </Card>

      {assignment.accessInstructions && (
        <Card>
          <CardHeader>
            <CardTitle>Instrucciones de acceso</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[13px] text-text-2">
              {assignment.accessInstructions}
            </p>
          </CardContent>
        </Card>
      )}

      {(assignment.siteContactName || assignment.siteContactPhone) && (
        <Card>
          <CardHeader>
            <CardTitle>Contacto de la sede</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-2">
            <p className="text-[13px] text-text-2">
              {assignment.siteContactName ?? 'Sin nombre cargado'}
            </p>
            {telHref && (
              <a
                href={telHref}
                className="flex min-h-11 items-center gap-2 text-[13px] font-semibold text-primary"
              >
                <Phone aria-hidden="true" className="size-4" />
                {assignment.siteContactPhone}
              </a>
            )}
          </CardContent>
        </Card>
      )}

      {peers && peers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Compañeros de este servicio</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {peers.map((peer) => (
              <PersonCell
                key={peer.profileId}
                id={peer.profileId}
                name={`${peer.firstName} ${peer.lastName}`}
                avatarSrc={peer.avatarPath ? avatarUrl(peer.avatarPath) : null}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {tasks && tasks.length > 0 && (
        <Card variant="flush">
          <CardHeader>
            <CardTitle>Tareas previstas</CardTitle>
          </CardHeader>
          <CardContent>
            <TaskList
              tasks={tasks.map((task) => ({
                id: task.id,
                title: task.title,
                description: task.description ?? undefined,
                status: task.status,
                isRequired: task.isRequired,
                notDoneReason: task.notDoneReason ?? undefined,
              }))}
              readOnly
            />
          </CardContent>
        </Card>
      )}

      {assignment.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Tu observación</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[13px] text-text-2">{assignment.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** Mismo criterio que `TodayPage.tsx`: `"HH:MM:SS"` es hora de pared, no un instante. */
function formatTimeOfDay(time: string): string {
  return time.slice(0, 5)
}

/** Minutos entre dos horas `"HH:MM:SS"` del mismo día (las franjas no cruzan la medianoche, `shifts_time_range_check`). */
function minutesBetween(start: string, end: string): number | null {
  const startMinutes = toMinutes(start)
  const endMinutes = toMinutes(end)
  if (startMinutes == null || endMinutes == null) return null
  return Math.max(0, endMinutes - startMinutes)
}

function toMinutes(time: string): number | null {
  const [hours, minutes] = time.split(':').map(Number)
  if (
    hours == null ||
    minutes == null ||
    Number.isNaN(hours) ||
    Number.isNaN(minutes)
  ) {
    return null
  }
  return hours * 60 + minutes
}
