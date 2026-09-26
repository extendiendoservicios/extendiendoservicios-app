import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { MyDayAssignment } from '@/api/myDay'

/**
 * `RegisterStartScreen` (EMP-05, MOB-EMP-007, `05` fila EMP-05): el servicio
 * elegido, la hora actual como referencia y el botón grande "Registrar
 * inicio". Puramente de presentación (mismo criterio que
 * `LocationConsentScreen`): quien la usa (`ClockTabPage`) resuelve la
 * ubicación, llama a `record_check_in` y decide a dónde navegar después.
 */
export interface RegisterStartScreenProps {
  assignment: Pick<
    MyDayAssignment,
    'clientName' | 'siteName' | 'startTime' | 'endTime'
  >
  /** Hora actual del dispositivo, ya formateada (`"HH:mm"`) -- solo de referencia, ver la nota debajo del reloj. */
  nowLabel: string
  onConfirm: () => void
  busy?: boolean
  error?: string | null
  offline?: boolean
}

export function RegisterStartScreen({
  assignment,
  nowLabel,
  onConfirm,
  busy = false,
  error = null,
  offline = false,
}: RegisterStartScreenProps) {
  const disabled = busy || offline

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-1">
          <p className="text-[16px] font-bold text-text">
            {assignment.clientName}
          </p>
          <p className="text-[12px] text-text-3">{assignment.siteName}</p>
          <p className="mt-1 text-[12px] text-text-3">
            {formatTimeOfDay(assignment.startTime)}–
            {formatTimeOfDay(assignment.endTime)}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col items-center gap-1 py-4">
        <p className="text-[22px] font-bold tabular-nums text-text">
          {nowLabel}
        </p>
        <p className="text-center text-[11px] text-text-3">
          Hora de referencia de tu celular. La hora que vale y queda registrada
          es la del servidor.
        </p>
      </div>

      {error && (
        <Alert variant="crit">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {offline && (
        <Alert variant="warn">
          <AlertDescription>
            Estás sin conexión. Conectate para poder fichar.
          </AlertDescription>
        </Alert>
      )}

      <Button
        size="mobile"
        onClick={onConfirm}
        loading={busy}
        disabled={disabled}
        className="mt-auto"
      >
        Registrar inicio
      </Button>
    </div>
  )
}

function formatTimeOfDay(time: string): string {
  return time.slice(0, 5)
}
