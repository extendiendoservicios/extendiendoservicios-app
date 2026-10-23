import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { getCurrentPositionSafe } from '@/lib/geolocation'
import {
  revokeLocationConsent,
  saveLocationConsent,
} from '@/api/locationConsent'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCompanySettingsQuery } from '@/features/settings/queries'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { rememberLocationDeclined } from '@/features/employee/locationChoice'
import { LocationConsentScreen } from '@/features/employee/components/LocationConsentScreen'

/**
 * Consentimiento de ubicación del coordinador (P24.2, CJ-21, ADR-009, B-22):
 * el mismo texto y los mismos dos botones de EMP-06 (`LocationConsentScreen`),
 * en un diálogo para que sirva desde cualquier botón de la jornada o de la
 * supervisión, sin una ruta propia. El orden es el de P-091: primero se guarda
 * el consentimiento y recién después se pide el permiso del navegador.
 *
 * Nunca bloquea: «Continuar sin ubicación» deja seguir sin coordenadas. Si el
 * guardado falla se avisa y se puede reintentar o seguir sin ubicación.
 */
export function LocationConsentGate({
  open,
  onResolved,
  onCancel,
}: {
  open: boolean
  /** `granted`: aceptó (y se pidió el permiso del navegador); `false`: siguió sin ubicación. */
  onResolved: (granted: boolean) => void
  onCancel: () => void
}) {
  const auth = useAuth()
  const online = useOnlineStatus()
  const queryClient = useQueryClient()
  const { data: settings } = useCompanySettingsQuery()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAccept() {
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
    // Recién ahora se pide el permiso del navegador (P-091).
    await getCurrentPositionSafe()
    setBusy(false)
    onResolved(true)
  }

  async function handleSkip() {
    if (!auth.userId) return
    rememberLocationDeclined(auth.userId)
    // Si ya había consentido y ahora lo rechaza (por ejemplo, porque el texto
    // cambió), se retira el consentimiento guardado (B-22).
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
    onResolved(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent showCloseButton={false} className="gap-4">
        <DialogTitle className="sr-only">Tu ubicación al fichar</DialogTitle>
        {error && (
          <Alert variant="crit">
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
      </DialogContent>
    </Dialog>
  )
}
