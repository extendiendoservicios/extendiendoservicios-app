import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatTime } from '@/lib/format'
import { isApiError } from '@/api/errors'
import type { AttendanceGeo } from '@/api/attendanceGeo'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { OPEN_SHIFT_DAY_ENDED_MESSAGE } from '@/features/employee/shiftRange'
import { useNow } from '@/features/employee/useNow'
import { useLocationConsent } from '@/features/employee/useLocationConsent'
import { useGeoFichaje } from '@/features/employee/useGeoFichaje'
import { GeoFichajePanel } from '@/features/employee/components/GeoFichajePanel'
import { AttendanceResultScreen } from '@/features/employee/components/AttendanceResultScreen'
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
 *
 * Módulo H (P21.3, H-07): si el servicio pide fotos y no hay ninguna propia,
 * se advierte con «Sacar foto» (lleva al bloque de EMP-07) y el botón
 * principal pasa a decir «Finalizar igual». No bloquea. Sin advertencia en
 * sedes que no permiten fotos (no habría cómo cumplirla).
 *
 * Módulo B1 (P22.3, B-06, B-18, B-38): igual que EMP-05, con consentimiento
 * vigente sigue la posición en vivo y muestra el mini mapa, la precisión y
 * «Esperar mejor señal»; el registro nunca se bloquea. Si el texto del
 * consentimiento cambió después de que la persona lo diera (B-22), antes se
 * lo vuelve a mostrar (EMP-06) y se regresa acá. Después de registrar el fin
 * se muestra el resultado que devolvió la base antes de pasar al resumen.
 */
export default function FinishPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const consent = useLocationConsent()
  const now = useNow(CLOCK_TICK_MS)
  const { data: myDay, isLoading } = useMyDayQuery()
  const assignment = myDay?.find((a) => a.assignmentId === assignmentId)
  const { data: tasks } = useShiftTasksQuery(assignment?.shiftId ?? '')
  const recordCheckOut = useRecordCheckOutMutation()
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    recordedAt: string
    geo: AttendanceGeo
  } | null>(null)
  const fichaje = useGeoFichaje({
    enabled: consent.status === 'granted' && assignment != null,
    siteLatitude: assignment?.siteLatitude ?? null,
    siteLongitude: assignment?.siteLongitude ?? null,
    radiusM: assignment?.siteGeofenceRadiusM ?? null,
    maxAccuracyM: assignment?.geofenceMaxAccuracyM ?? null,
  })

  if (result) {
    return (
      <AttendanceResultScreen
        title="Fin registrado"
        recordedAt={result.recordedAt}
        geo={result.geo}
        heading={
          assignment
            ? {
                primary: assignment.clientName,
                secondary: assignment.siteName,
              }
            : undefined
        }
        onContinue={() =>
          void navigate(`/app/resumen/${assignmentId}`, { replace: true })
        }
        continueLabel="Ver el resumen"
      />
    )
  }

  if (isLoading || consent.loading) {
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

  if (assignment.shiftStatus === 'cancelled') {
    return <Navigate to={`/app/servicio/${assignment.assignmentId}`} replace />
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
  // AJ2-09: «Sin salida» (pasó el día del turno «A terminar»): lo carga la administración.
  if (assignment.noCheckout) {
    return <Navigate to={`/app/servicio/${assignment.assignmentId}`} replace />
  }

  // B-22: el texto del consentimiento cambió después de que lo diera.
  if (consent.reconsent && consent.status === 'needs-consent') {
    const back = `/app/en-curso/${assignment.assignmentId}/finalizar`
    return (
      <Navigate
        to={`/app/fichar/consentimiento?volver=${encodeURIComponent(back)}`}
        replace
      />
    )
  }

  const pendingRequired = tasks ? countPendingRequiredTasks(tasks) : 0
  const earlyLeave = isEarlyLeave(now, assignment)
  const missingPhotos =
    assignment.requiresPhotos &&
    assignment.myPhotosCount === 0 &&
    !assignment.photosNotAllowed
  const disabled = !online || recordCheckOut.isPending

  async function handleConfirm() {
    setError(null)
    try {
      const record = await recordCheckOut.mutateAsync({
        assignmentId: assignment!.assignmentId,
        coords: fichaje.payload.coords,
        outsideReason: fichaje.payload.outsideReason,
      })
      if (record.geo) {
        setResult({ recordedAt: record.recordedAt, geo: record.geo })
      } else {
        void navigate(`/app/resumen/${assignment!.assignmentId}`, {
          replace: true,
        })
      }
    } catch (mutationError) {
      setError(
        isApiError(mutationError)
          ? mutationError.hint === 'OPEN_SHIFT_DAY_ENDED'
            ? OPEN_SHIFT_DAY_ENDED_MESSAGE
            : mutationError.message
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

      <GeoFichajePanel
        fichaje={fichaje}
        site={
          assignment.siteLatitude != null && assignment.siteLongitude != null
            ? {
                lat: assignment.siteLatitude,
                lng: assignment.siteLongitude,
                name: assignment.siteName,
              }
            : null
        }
        busy={recordCheckOut.isPending}
      />

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
      {missingPhotos && (
        <Alert variant="warn">
          <AlertDescription className="flex flex-col gap-2">
            <span>
              Este servicio pide fotos y todavía no subiste ninguna. Podés
              finalizar igual.
            </span>
            <Button asChild variant="ghost" size="mobile">
              <Link
                to={`/app/en-curso/${assignment.assignmentId}#fotos`}
                data-testid="finish-take-photo"
              >
                Sacar foto
              </Link>
            </Button>
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
        {missingPhotos || fichaje.view.poorSignal
          ? 'Finalizar igual'
          : 'Registrar fin'}
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
