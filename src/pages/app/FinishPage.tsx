import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatTime } from '@/lib/format'
import { isApiError } from '@/api/errors'
import { getCurrentPositionSafe } from '@/lib/geolocation'
import { useAuth } from '@/features/auth/AuthProvider'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { useNow } from '@/features/employee/useNow'
import {
  countPendingRequiredTasks,
  isEarlyLeave,
} from '@/features/employee/finishSummary'
import {
  useMyDayQuery,
  useRecordCheckOutMutation,
  useShiftTasksQuery,
} from '@/features/employee/queries'

/** La hora de referencia de EMP-10 no necesita actualizarse segundo a segundo. */
const CLOCK_TICK_MS = 15_000

/**
 * EMP-10 · Finalizar servicio (MOB-EMP-011, `05` fila EMP-10, P-076,
 * `record_check_out`): resumen antes de confirmar (inicio, hora actual,
 * tareas, observación cargada o no), avisos de tareas obligatorias
 * pendientes y de salida anticipada -- los dos informativos, ninguno
 * bloquea el botón. Misma regla de ubicación que EMP-05.
 */
export default function FinishPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const navigate = useNavigate()
  const auth = useAuth()
  const online = useOnlineStatus()
  const now = useNow(CLOCK_TICK_MS)
  const { data: myDay, isLoading } = useMyDayQuery()
  const assignment = myDay?.find((a) => a.assignmentId === assignmentId)
  const { data: tasks } = useShiftTasksQuery(assignment?.shiftId ?? '')
  const recordCheckOut = useRecordCheckOutMutation()
  const [error, setError] = useState<string | null>(null)

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

  // Sin inicio registrado no hay nada que finalizar; con el fin ya
  // registrado, lo que corresponde es el comprobante (EMP-11), no esta
  // pantalla (mismo criterio que `InProgressPage`).
  if (assignment.checkInAt == null) {
    return <Navigate to="/app/fichar" replace />
  }
  if (assignment.checkOutAt != null) {
    return <Navigate to={`/app/resumen/${assignment.assignmentId}`} replace />
  }

  const hasConsent = auth.profile?.locationConsentAt != null
  const pendingRequired = tasks ? countPendingRequiredTasks(tasks) : 0
  const earlyLeave = isEarlyLeave(now, assignment)
  const disabled = !online || recordCheckOut.isPending

  async function handleConfirm() {
    setError(null)
    const coords = hasConsent ? await getCurrentPositionSafe() : null
    try {
      await recordCheckOut.mutateAsync({
        assignmentId: assignment!.assignmentId,
        coords,
      })
      void navigate(`/app/resumen/${assignment!.assignmentId}`, {
        replace: true,
      })
    } catch (mutationError) {
      setError(
        isApiError(mutationError)
          ? mutationError.message
          : 'No pudimos registrar el fin. Probá de nuevo.',
      )
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-[6px]">
          <SummaryRow label="Inicio" value={formatTime(assignment.checkInAt)} />
          <SummaryRow label="Hora actual" value={formatTime(now)} />
          <SummaryRow
            label="Tareas"
            value={`${assignment.tasksDone} de ${assignment.tasksTotal} completadas`}
          />
          <SummaryRow
            label="Observación"
            value={assignment.notes ? 'Cargada' : 'Sin observación'}
          />
        </CardContent>
      </Card>

      {pendingRequired > 0 && (
        <Alert variant="warn">
          <AlertDescription>
            Tenés {pendingRequired}{' '}
            {pendingRequired === 1
              ? 'tarea obligatoria pendiente'
              : 'tareas obligatorias pendientes'}
            . Podés registrar el fin igual.
          </AlertDescription>
        </Alert>
      )}
      {earlyLeave && (
        <Alert variant="warn">
          <AlertDescription>
            Vas a registrar la salida antes del horario previsto.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="crit">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!online && (
        <Alert variant="warn">
          <AlertDescription>
            Estás sin conexión. Conectate para poder registrar el fin.
          </AlertDescription>
        </Alert>
      )}

      <Button
        size="mobile"
        onClick={() => void handleConfirm()}
        loading={recordCheckOut.isPending}
        disabled={disabled}
        className="mt-auto"
      >
        Registrar fin
      </Button>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-text-3">{label}</span>
      <span className="text-[13px] font-semibold text-text">{value}</span>
    </div>
  )
}
