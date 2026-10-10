import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatTime } from '@/lib/format'
import { isApiError } from '@/api/errors'
import { getCurrentPositionSafe } from '@/lib/geolocation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCompanySettingsQuery } from '@/features/settings/queries'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { useNow } from '@/features/employee/useNow'
import {
  hasDeclinedLocation,
  rememberLocationDeclined,
} from '@/features/employee/locationChoice'
import { LocationConsentScreen } from '@/features/employee/components/LocationConsentScreen'
import { RegisterStartScreen } from '@/features/employee/components/RegisterStartScreen'
import {
  useMySupervisionQuery,
  useSupervisionCheckInMutation,
  useSupervisionCheckOutMutation,
  type MySupervision,
} from '@/api/mySupervisions'

/** Hora de referencia, mismo intervalo que EMP-05/EMP-10 (no necesita el segundo a segundo). */
const CLOCK_TICK_MS = 15_000

/** Estados en los que ya no hay nada para registrar en esta pantalla. */
const CLOSED_STATUSES = new Set(['completed', 'not_done', 'cancelled'])

/**
 * SUP-04 · Inicio y fin de supervisión (MOB-SUP-005, `05` fila SUP-04, `06`
 * sección 12): una sola pantalla que muestra lo que corresponde según el
 * estado real de la supervisión propia --
 *
 * - Sin inicio registrado: pide el consentimiento de ubicación si todavía no
 *   está resuelto (el mismo componente `LocationConsentScreen` de EMP-06,
 *   reutilizado tal cual pide MOB-SUP-005 -- "consentimiento reutilizado de
 *   EMP-06"; acá va inline, en la misma pantalla y sin ruta propia, porque
 *   SUP-04 solo tiene una entrada, a diferencia de EMP-06 que atiende varios
 *   puntos de entrada del empleado) y después el botón "Registrar inicio"
 *   (`RegisterStartScreen`, misma pantalla presentacional que usa EMP-05:
 *   sin acoplarse a ningún dominio, solo pide `clientName`/`siteName`/
 *   `startTime`/`endTime`, que una supervisión también tiene).
 * - Con inicio y sin fin: hora de inicio y el botón "Registrar fin".
 * - Cerrada o cancelada: no hay nada para registrar -- vuelve a SUP-03.
 *
 * Al registrar el fin, todavía no existe SUP-06 (cerrar supervisión,
 * P15.5): se vuelve al detalle (SUP-03), que en ese paquete va a ofrecer el
 * acceso a cerrar en vez de al registro.
 */
export default function SupervisionAttendancePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const auth = useAuth()
  const online = useOnlineStatus()
  const now = useNow(CLOCK_TICK_MS)
  const { data: settings } = useCompanySettingsQuery()
  const {
    data: supervision,
    isLoading,
    isError,
  } = useMySupervisionQuery(id ?? '')
  const checkIn = useSupervisionCheckInMutation()
  const checkOut = useSupervisionCheckOutMutation()
  const [error, setError] = useState<string | null>(null)
  const [consentBusy, setConsentBusy] = useState(false)
  const [locationSkipped, setLocationSkipped] = useState(false)

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (isError || !supervision) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No encontramos esa supervisión. Volvé a Hoy e intentá de nuevo.
        </AlertDescription>
      </Alert>
    )
  }
  if (CLOSED_STATUSES.has(supervision.status)) {
    return <Navigate to={`/sup/supervisiones/${supervision.id}`} replace />
  }

  const hasConsent = auth.profile?.locationConsentAt != null

  async function handleAcceptLocation() {
    if (!auth.userId) return
    setConsentBusy(true)
    setError(null)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ location_consent_at: new Date().toISOString() })
      .eq('id', auth.userId)

    if (updateError) {
      setConsentBusy(false)
      setError('No pudimos guardar tu consentimiento. Probá de nuevo.')
      return
    }
    await auth.refreshProfile()
    // Recién ahora se pide el permiso del navegador (P-091, mismo orden que
    // `LocationConsentPage`); el registro real vuelve a pedir la posición en
    // el momento de fichar, esta llamada solo dispara el diálogo del
    // navegador en este paso explicativo.
    await getCurrentPositionSafe()
    setConsentBusy(false)
  }

  function handleSkipLocation() {
    rememberLocationDeclined(auth.userId)
    setLocationSkipped(true)
  }

  async function handleCheckIn() {
    setError(null)
    const coords = hasConsent ? await getCurrentPositionSafe() : null
    try {
      await checkIn.mutateAsync({ supervisionId: supervision!.id, coords })
    } catch (mutationError) {
      setError(
        isApiError(mutationError)
          ? mutationError.message
          : 'No pudimos registrar el inicio. Probá de nuevo.',
      )
    }
  }

  async function handleCheckOut() {
    setError(null)
    const coords = hasConsent ? await getCurrentPositionSafe() : null
    try {
      await checkOut.mutateAsync({ supervisionId: supervision!.id, coords })
      void navigate(`/sup/supervisiones/${supervision!.id}`, { replace: true })
    } catch (mutationError) {
      setError(
        isApiError(mutationError)
          ? mutationError.message
          : 'No pudimos registrar el fin. Probá de nuevo.',
      )
    }
  }

  if (supervision.checkInAt == null) {
    const locationDecided =
      hasConsent || hasDeclinedLocation(auth.userId) || locationSkipped

    if (!locationDecided) {
      return (
        <div className="flex flex-1 flex-col">
          {error && (
            <Alert variant="crit" className="mb-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <LocationConsentScreen
            consentText={settings?.locationConsentText ?? null}
            onAccept={() => void handleAcceptLocation()}
            onSkip={handleSkipLocation}
            busy={consentBusy}
            offline={!online}
          />
        </div>
      )
    }

    return (
      <RegisterStartScreen
        assignment={{
          clientName: supervision.clientName,
          siteName: supervision.siteName,
          startTime: supervision.startTime,
          endTime: supervision.endTime,
          openEnded: supervision.shiftOpenEnded,
        }}
        nowLabel={formatTime(now)}
        onConfirm={() => void handleCheckIn()}
        busy={checkIn.isPending}
        error={error}
        offline={!online}
      />
    )
  }

  return (
    <FinishStep
      supervision={supervision}
      onConfirm={() => void handleCheckOut()}
      busy={checkOut.isPending}
      error={error}
      offline={!online}
    />
  )
}

function FinishStep({
  supervision,
  onConfirm,
  busy,
  error,
  offline,
}: {
  supervision: MySupervision
  onConfirm: () => void
  busy: boolean
  error: string | null
  offline: boolean
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-1">
          <p className="text-[16px] font-bold text-text">
            {supervision.clientName}
          </p>
          <p className="text-[12px] text-text-3">{supervision.siteName}</p>
        </CardContent>
      </Card>

      <div className="flex flex-col items-center gap-1 py-4">
        <p className="text-[13px] text-text-2">
          Supervisión iniciada a las{' '}
          <span className="font-semibold text-text">
            {formatTime(supervision.checkInAt!)}
          </span>
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
            Estás sin conexión. Conectate para poder registrar el fin.
          </AlertDescription>
        </Alert>
      )}

      <Button
        size="mobile"
        onClick={onConfirm}
        loading={busy}
        disabled={busy || offline}
        className="mt-auto"
      >
        Registrar fin
      </Button>
    </div>
  )
}
