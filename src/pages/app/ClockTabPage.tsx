import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { CalendarCheck2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { RadioGroup } from '@/components/ui/radio-group'
import { OptionCard } from '@/components/OptionCard'
import { EmptyState } from '@/components/EmptyState'
import { useAuth } from '@/features/auth/AuthProvider'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { hasDeclinedLocation } from '@/features/employee/locationChoice'
import { useMyDayQuery } from '@/features/employee/queries'
import type { MyDayAssignment } from '@/api/myDay'

/**
 * EMP-14 · Fichar (tab) (MOB-EMP-005, `05` fila EMP-14): punto de entrada
 * del botón central. No tiene una lógica de UI propia demasiado grande —
 * decide a dónde apunta el botón "Fichar" según el estado de hoy:
 *
 * - Un servicio en curso (inicio registrado, fin no) → redirige a EMP-07
 *   (`/app/en-curso/:id`, todavía un marcador — la pantalla real es
 *   P13.3).
 * - Nada por fichar hoy (ni en curso, ni pendiente) → mensaje.
 * - Un solo servicio por empezar → sigue directo con ese.
 * - Más de uno por empezar → hay que elegirlo primero (`05` fila EMP-05:
 *   "Servicio de hoy seleccionado (si hay más de uno, elegir)"), con
 *   `OptionCard` dentro de un `RadioGroup` (mismo patrón que
 *   `/dev/design`). La elección queda en `?asignacion=` para sobrevivir el
 *   viaje de ida y vuelta a EMP-06 (`LocationConsentPage` navega de vuelta
 *   acá con el mismo parámetro).
 * - Ya elegido un servicio pendiente: si el empleado no dio su
 *   consentimiento de ubicación (`profiles.location_consent_at`), primero
 *   pasa por EMP-06; si ya lo dio, esta pantalla deja el marcador simple de
 *   "acá va a estar el registro de inicio" (EMP-05, la pantalla con el
 *   botón real y `record_check_in`, es de P13.3 — MOB-EMP-005 solo pide
 *   dejar la navegación lista, sin construirla).
 */
export default function ClockTabPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const auth = useAuth()
  const online = useOnlineStatus()
  const { data, isLoading, isError } = useMyDayQuery()

  const today = data?.filter((a) => a.isToday) ?? []
  const inProgress = today.find(
    (a) => a.checkInAt != null && a.checkOutAt == null,
  )

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

  if (inProgress) {
    return <Navigate to={`/app/en-curso/${inProgress.assignmentId}`} replace />
  }

  const pending = today.filter(
    (a) => a.checkInAt == null && a.status !== 'absence_notified',
  )

  if (pending.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck2}
        title={
          today.length === 0
            ? 'No tenés servicios para fichar hoy'
            : 'Ya fichaste todos tus servicios de hoy'
        }
        className="mt-4"
      />
    )
  }

  const selectedId = searchParams.get('asignacion')
  const selected =
    pending.length === 1
      ? pending[0]
      : pending.find((a) => a.assignmentId === selectedId)

  if (!selected) {
    return (
      <ChooseService
        pending={pending}
        onChoose={(assignmentId) =>
          setSearchParams({ asignacion: assignmentId })
        }
      />
    )
  }

  // Con el consentimiento dado o la negativa recordada, se sigue al registro
  // (sin ubicación en el segundo caso, P-091).
  const locationDecided =
    auth.profile?.locationConsentAt != null || hasDeclinedLocation(auth.userId)

  if (!locationDecided) {
    return (
      <ConsentNeeded
        assignment={selected}
        onContinue={() =>
          void navigate(
            `/app/fichar/consentimiento?asignacion=${selected.assignmentId}`,
          )
        }
      />
    )
  }

  return <RegisterStartPlaceholder assignment={selected} offline={!online} />
}

function ChooseService({
  pending,
  onChoose,
}: {
  pending: MyDayAssignment[]
  onChoose: (assignmentId: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] font-semibold text-text">
        Tenés más de un servicio hoy. ¿Cuál vas a empezar?
      </p>
      <RadioGroup onValueChange={onChoose}>
        {pending.map((assignment) => (
          <OptionCard
            key={assignment.assignmentId}
            value={assignment.assignmentId}
            title={assignment.siteName}
            description={`${assignment.startTime.slice(0, 5)}–${assignment.endTime.slice(0, 5)}`}
          />
        ))}
      </RadioGroup>
    </div>
  )
}

function ConsentNeeded({
  assignment,
  onContinue,
}: {
  assignment: MyDayAssignment
  onContinue: () => void
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-1">
          <p className="text-[13px] font-semibold text-text">
            {assignment.siteName}
          </p>
          <p className="text-[12px] text-text-3">
            {assignment.startTime.slice(0, 5)}–{assignment.endTime.slice(0, 5)}
          </p>
        </CardContent>
      </Card>
      <p className="text-[12.5px] text-text-3">
        Antes de registrar el inicio, te pedimos tu consentimiento de ubicación.
      </p>
      <Button size="mobile" onClick={onContinue} className="mt-auto">
        Continuar
      </Button>
    </div>
  )
}

/**
 * Marcador de EMP-05 (P13.3, `record_check_in`): esta pantalla ya resolvió
 * cuál asignación corresponde y que el consentimiento de ubicación quedó
 * resuelto (dado o rechazado) — falta el botón real de "Registrar inicio",
 * fuera del alcance de este paquete.
 */
function RegisterStartPlaceholder({
  assignment,
  offline,
}: {
  assignment: MyDayAssignment
  offline: boolean
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-1">
          <p className="text-[13px] font-semibold text-text">
            {assignment.clientName}
          </p>
          <p className="text-[12px] text-text-3">{assignment.siteName}</p>
          <p className="mt-1 text-[12px] text-text-3">
            {assignment.startTime.slice(0, 5)}–{assignment.endTime.slice(0, 5)}
          </p>
        </CardContent>
      </Card>
      {offline && (
        <Alert variant="warn">
          <AlertDescription>
            Estás sin conexión. Conectate para poder fichar.
          </AlertDescription>
        </Alert>
      )}
      <Button size="mobile" disabled className="mt-auto">
        Registrar inicio
      </Button>
      <p className="text-center text-[11px] text-text-3">
        Disponible en la próxima entrega.
      </p>
    </div>
  )
}
