import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  revokeLocationConsent,
  saveLocationConsent,
} from '@/api/locationConsent'
import { getCurrentPositionSafe } from '@/lib/geolocation'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCompanySettingsQuery } from '@/features/settings/queries'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { rememberLocationDeclined } from '@/features/employee/locationChoice'
import { LocationConsentScreen } from '@/features/employee/components/LocationConsentScreen'
import { Alert, AlertDescription } from '@/components/ui/alert'

/**
 * EMP-06 · Consentimiento de ubicación (MOB-EMP-006, ADR-009, P-067, P-091,
 * P-108): envuelve `LocationConsentScreen` con lo que le falta para ser una
 * pantalla real — el texto de la empresa, guardar `location_consent_at` y
 * recién después pedir el permiso del navegador (en ese orden, tal como
 * pide la fila EMP-06 de `05`), y volver a "Fichar" (`/app/fichar`) con la
 * misma asignación elegida (`?asignacion=`, la deja puesta EMP-14 antes de
 * mandar para acá) para que esa pantalla siga el flujo justo donde lo dejó.
 *
 * El fichaje (EMP-05 / EMP-10) sigue la posición en vivo por su cuenta
 * (`useLivePosition`, módulo B1): el pedido de acá solo existe para que el
 * diálogo de permiso del navegador aparezca en este paso explicativo, como
 * pide P-091, no para reusar esas coordenadas después.
 *
 * Módulo B1 (B-22): esta pantalla también se muestra de nuevo cuando la
 * empresa cambia el texto del consentimiento. Si la persona ya había
 * consentido y ahora elige «Continuar sin ubicación», se retira el
 * consentimiento guardado (queda sin ubicación, igual que si lo retirara
 * desde su perfil): si no, la app se lo seguiría pidiendo en cada fichaje.
 * Con `?volver=/app/...` regresa a esa pantalla (EMP-10) en vez de a Fichar.
 */
export default function LocationConsentPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const online = useOnlineStatus()
  const queryClient = useQueryClient()
  const { data: settings } = useCompanySettingsQuery()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function goBackToFichar() {
    const back = searchParams.get('volver')
    // Solo rutas internas del empleado: nunca un destino externo.
    if (back && back.startsWith('/app/') && !back.startsWith('//')) {
      void navigate(back, { replace: true })
      return
    }
    const assignmentId = searchParams.get('asignacion')
    void navigate(
      assignmentId
        ? `/app/fichar?asignacion=${encodeURIComponent(assignmentId)}`
        : '/app/fichar',
      { replace: true },
    )
  }

  async function handleAccept() {
    if (!auth.userId) return
    setBusy(true)
    setError(null)
    try {
      await saveLocationConsent()
    } catch {
      setBusy(false)
      setError('No pudimos guardar tu consentimiento. Probá de nuevo.')
      return
    }

    await auth.refreshProfile()
    await queryClient.invalidateQueries({
      queryKey: ['employee', 'locationConsent'],
    })
    // Recién ahora se pide el permiso del navegador (P-091). No importa el
    // resultado acá (concedido, negado o sin respuesta a tiempo): el
    // registro de inicio/fin (P13.3) vuelve a pedirlo por su cuenta en el
    // momento real, y de última funciona igual sin ubicación (ADR-009).
    await getCurrentPositionSafe()
    setBusy(false)
    goBackToFichar()
  }

  async function handleSkip() {
    if (!auth.userId) return
    rememberLocationDeclined(auth.userId)
    if (auth.profile?.locationConsentAt != null) {
      setBusy(true)
      try {
        await revokeLocationConsent()
        await auth.refreshProfile()
      } catch {
        setBusy(false)
        setError('No pudimos guardar tu elección. Probá de nuevo.')
        return
      }
      setBusy(false)
    }
    goBackToFichar()
  }

  return (
    <div className="flex flex-1 flex-col">
      {error && (
        <Alert variant="crit" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <LocationConsentScreen
        consentText={settings?.locationConsentText ?? null}
        onAccept={() => void handleAccept()}
        onSkip={() => void handleSkip()}
        busy={busy}
        offline={!online}
      />
    </div>
  )
}
