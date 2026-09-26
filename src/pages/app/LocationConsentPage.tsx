import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { supabase } from '@/lib/supabase'
import { getCurrentPositionSafe } from '@/lib/geolocation'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCompanySettingsQuery } from '@/features/settings/queries'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
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
 * `record_check_in`/`record_check_out` (P13.3) van a volver a pedir la
 * posición en el momento mismo de fichar (nunca se guarda una posición
 * "vieja" de acá): el pedido de acá solo existe para que el diálogo de
 * permiso del navegador aparezca en este paso explicativo, como pide P-091,
 * no para reusar esas coordenadas después.
 */
export default function LocationConsentPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const online = useOnlineStatus()
  const { data: settings } = useCompanySettingsQuery()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function goBackToFichar() {
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
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ location_consent_at: new Date().toISOString() })
      .eq('id', auth.userId)

    if (updateError) {
      setBusy(false)
      setError('No pudimos guardar tu consentimiento. Probá de nuevo.')
      return
    }

    await auth.refreshProfile()
    // Recién ahora se pide el permiso del navegador (P-091). No importa el
    // resultado acá (concedido, negado o sin respuesta a tiempo): el
    // registro de inicio/fin (P13.3) vuelve a pedirlo por su cuenta en el
    // momento real, y de última funciona igual sin ubicación (ADR-009).
    await getCurrentPositionSafe()
    setBusy(false)
    goBackToFichar()
  }

  function handleSkip() {
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
        onSkip={handleSkip}
        busy={busy}
        offline={!online}
      />
    </div>
  )
}
