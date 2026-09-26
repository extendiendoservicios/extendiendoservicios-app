import type { ComponentType } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { ClipboardList, MessageSquare, Square, WifiOff } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ProgressBar } from '@/components/ProgressBar'
import { formatTime } from '@/lib/format'
import { elapsedSeconds, formatElapsed } from '@/features/employee/chronometer'
import { useNow } from '@/features/employee/useNow'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { useMyDayQuery } from '@/features/employee/queries'

/** Un segundo: el cronómetro se ve andar en tiempo real (`07`: "Móvil: cronómetro"). */
const CHRONOMETER_TICK_MS = 1_000

/**
 * EMP-07 · Servicio en curso (MOB-EMP-008, `05` fila EMP-07): cronómetro
 * desde `check_in_at` (la hora que puso el servidor al registrar el inicio,
 * nunca la del dispositivo), fin previsto, progreso de tareas y los accesos
 * a Tareas (EMP-08), Observaciones (EMP-09) y Finalizar (EMP-10).
 *
 * Si la asignación no está realmente en curso (todavía no se registró el
 * inicio, o ya se registró el fin) esta pantalla no tiene sentido para ese
 * `assignmentId`: redirige a donde corresponda en cada caso, en vez de
 * mostrar un cronómetro que no arrancó o que ya no corre.
 */
export default function InProgressPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const online = useOnlineStatus()
  const { data, isLoading, isError } = useMyDayQuery()
  const now = useNow(CHRONOMETER_TICK_MS)

  const assignment = data?.find((a) => a.assignmentId === assignmentId)

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
  if (!assignment) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No encontramos ese servicio. Volvé a Hoy e intentá de nuevo.
        </AlertDescription>
      </Alert>
    )
  }
  // Todavía no se registró el inicio: no hay nada "en curso" que mostrar acá
  // -- de vuelta a Fichar, que sabe a dónde mandar a la persona.
  if (assignment.checkInAt == null) {
    return <Navigate to="/app/fichar" replace />
  }
  // Ya se registró el fin: el cronómetro dejó de correr, lo que corresponde
  // ver es el comprobante (EMP-11), no esta pantalla.
  if (assignment.checkOutAt != null) {
    return <Navigate to={`/app/resumen/${assignment.assignmentId}`} replace />
  }

  const seconds = elapsedSeconds(assignment.checkInAt, now)
  const progress =
    assignment.tasksTotal > 0
      ? Math.round((assignment.tasksDone / assignment.tasksTotal) * 100)
      : 0

  return (
    <div className="flex flex-col gap-4">
      {!online && (
        <Alert variant="warn">
          <WifiOff aria-hidden="true" />
          <AlertDescription>
            Estás sin conexión. Vas a poder seguir viendo tu servicio, pero
            registrar cosas nuevas va a esperar a que vuelvas a tener señal.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-col gap-1">
          <p className="text-[16px] font-bold text-text">
            {assignment.clientName}
          </p>
          <p className="text-[12px] text-text-3">{assignment.siteName}</p>
        </CardContent>
      </Card>

      <div className="flex flex-col items-center gap-1 py-2">
        <p className="text-[33px] font-bold tabular-nums text-text">
          {formatElapsed(seconds)}
        </p>
        <p className="text-[11px] text-text-3">
          Iniciado a las {formatTime(assignment.checkInAt)} · fin previsto{' '}
          {formatTimeOfDay(assignment.endTime)}
        </p>
      </div>

      <div className="flex flex-col gap-[6px]">
        <div className="flex items-center justify-between text-[11px] text-text-3">
          <span>Tareas</span>
          <span>
            {assignment.tasksDone} de {assignment.tasksTotal}
          </span>
        </div>
        <ProgressBar
          value={progress}
          variant={progress === 100 ? 'ok' : 'default'}
          label="Progreso de tareas"
        />
      </div>

      <div className="mt-2 flex flex-col gap-3">
        <AccessRow
          to={`/app/en-curso/${assignment.assignmentId}/tareas`}
          icon={ClipboardList}
          label="Tareas"
        />
        <AccessRow
          to={`/app/en-curso/${assignment.assignmentId}/observaciones`}
          icon={MessageSquare}
          label="Observaciones"
        />
        <AccessRow
          to={`/app/en-curso/${assignment.assignmentId}/finalizar`}
          icon={Square}
          label="Finalizar servicio"
        />
      </div>
    </div>
  )
}

function AccessRow({
  to,
  icon: Icon,
  label,
}: {
  to: string
  icon: ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <Link
      to={to}
      className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-[13.5px] font-semibold text-text outline-none focus-visible:ring-3 focus-visible:ring-ring"
    >
      <Icon aria-hidden="true" className="size-[18px] shrink-0 text-primary" />
      {label}
    </Link>
  )
}

/** Mismo criterio que el resto de la vía: `"HH:MM:SS"` es hora de pared, no un instante. */
function formatTimeOfDay(time: string): string {
  return time.slice(0, 5)
}
