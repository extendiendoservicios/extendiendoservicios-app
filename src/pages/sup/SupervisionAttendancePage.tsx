import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatTime } from '@/lib/format'
import { isApiError } from '@/api/errors'
import { useQueryClient } from '@tanstack/react-query'
import { getCurrentPositionSafe } from '@/lib/geolocation'
import {
  revokeLocationConsent,
  saveLocationConsent,
} from '@/api/locationConsent'
import type { AttendanceGeo } from '@/api/attendanceGeo'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCompanySettingsQuery } from '@/features/settings/queries'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { useNow } from '@/features/employee/useNow'
import { rememberLocationDeclined } from '@/features/employee/locationChoice'
import { consentTimestamp } from '@/features/employee/locationConsent'
import { useLocationConsent } from '@/features/employee/useLocationConsent'
import {
  useGeoFichaje,
  type GeoFichaje,
} from '@/features/employee/useGeoFichaje'
import { GeoFichajePanel } from '@/features/employee/components/GeoFichajePanel'
import { AttendanceResultScreen } from '@/features/employee/components/AttendanceResultScreen'
import { LazyShiftMediaSection } from '@/features/employee/components/LazyShiftMediaSection'
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
 * Módulo H (P21.3): con el inicio registrado, el paso del fin también ofrece
 * el bloque «Fotos y videos» (se saca la evidencia durante la visita).
 *
 * Al registrar el fin, todavía no existe SUP-06 (cerrar supervisión,
 * P15.5): se vuelve al detalle (SUP-03), que en ese paquete va a ofrecer el
 * acceso a cerrar en vez de al registro.
 *
 * Módulo B1 (P22.3, B-07, B-18): el inicio y el fin se validan contra la sede
 * supervisada, con el mismo panel en vivo que el empleado (mini mapa,
 * precisión, «Esperar mejor señal», motivo opcional si está fuera de zona) y,
 * después de registrar, el resultado que devolvió la base. Si el texto del
 * consentimiento cambió después de que se diera (B-22), se vuelve a mostrar
 * antes de fichar el inicio o el fin.
 */
export default function SupervisionAttendancePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const auth = useAuth()
  const online = useOnlineStatus()
  const now = useNow(CLOCK_TICK_MS)
  const queryClient = useQueryClient()
  const consent = useLocationConsent()
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
  const [result, setResult] = useState<{
    kind: 'check_in' | 'check_out'
    recordedAt: string
    geo: AttendanceGeo
  } | null>(null)
  const fichaje = useGeoFichaje({
    enabled: consent.status === 'granted' && supervision != null,
    siteLatitude: supervision?.siteLatitude ?? null,
    siteLongitude: supervision?.siteLongitude ?? null,
    radiusM: supervision?.siteGeofenceRadiusM ?? null,
    maxAccuracyM: supervision?.geofenceMaxAccuracyM ?? null,
  })

  if (result && supervision) {
    return (
      <AttendanceResultScreen
        title={
          result.kind === 'check_in' ? 'Inicio registrado' : 'Fin registrado'
        }
        recordedAt={result.recordedAt}
        geo={result.geo}
        heading={{
          primary: supervision.clientName,
          secondary: supervision.siteName,
        }}
        onContinue={() => {
          if (result.kind === 'check_out') {
            void navigate(`/sup/supervisiones/${supervision.id}`, {
              replace: true,
            })
          }
          setResult(null)
        }}
        continueLabel={
          result.kind === 'check_in' ? 'Seguir con la supervisión' : 'Continuar'
        }
      />
    )
  }

  if (isLoading || consent.loading) {
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

  async function handleAcceptLocation() {
    if (!auth.userId) return
    setConsentBusy(true)
    setError(null)
    try {
      await saveLocationConsent(
        auth.userId,
        consentTimestamp(consent.consentUpdatedAt),
      )
    } catch {
      setConsentBusy(false)
      setError('No pudimos guardar tu consentimiento. Probá de nuevo.')
      return
    }
    await auth.refreshProfile()
    await queryClient.invalidateQueries({
      queryKey: ['employee', 'locationConsent'],
    })
    // Recién ahora se pide el permiso del navegador (P-091, mismo orden que
    // `LocationConsentPage`); el registro real vuelve a pedir la posición en
    // el momento de fichar, esta llamada solo dispara el diálogo del
    // navegador en este paso explicativo.
    await getCurrentPositionSafe()
    setConsentBusy(false)
  }

  async function handleSkipLocation() {
    if (!auth.userId) return
    rememberLocationDeclined(auth.userId)
    // Si ya había consentido y ahora lo rechaza, se retira el consentimiento
    // guardado (mismo criterio que EMP-06, B-22).
    if (auth.profile?.locationConsentAt != null) {
      setConsentBusy(true)
      try {
        await revokeLocationConsent(auth.userId)
        await auth.refreshProfile()
      } catch {
        setConsentBusy(false)
        setError('No pudimos guardar tu elección. Probá de nuevo.')
        return
      }
      setConsentBusy(false)
    }
    setLocationSkipped(true)
  }

  async function handleCheckIn() {
    setError(null)
    try {
      const record = await checkIn.mutateAsync({
        supervisionId: supervision!.id,
        coords: fichaje.payload.coords,
        outsideReason: fichaje.payload.outsideReason,
      })
      if (record.geo) {
        setResult({
          kind: 'check_in',
          recordedAt: record.recordedAt,
          geo: record.geo,
        })
      }
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
    try {
      const record = await checkOut.mutateAsync({
        supervisionId: supervision!.id,
        coords: fichaje.payload.coords,
        outsideReason: fichaje.payload.outsideReason,
      })
      if (record.geo) {
        setResult({
          kind: 'check_out',
          recordedAt: record.recordedAt,
          geo: record.geo,
        })
      } else {
        void navigate(`/sup/supervisiones/${supervision!.id}`, {
          replace: true,
        })
      }
    } catch (mutationError) {
      setError(
        isApiError(mutationError)
          ? mutationError.message
          : 'No pudimos registrar el fin. Probá de nuevo.',
      )
    }
  }

  // Antes del inicio se pide el consentimiento si nunca se resolvió; en
  // cualquier momento, si el texto cambió después de darlo (B-22). Con el
  // inicio ya registrado y sin decisión previa no se pregunta de nuevo: el fin
  // se registra sin ubicación.
  const needsConsentScreen =
    consent.status === 'needs-consent' &&
    !locationSkipped &&
    (supervision.checkInAt == null || consent.reconsent)

  if (needsConsentScreen) {
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
          onSkip={() => void handleSkipLocation()}
          busy={consentBusy}
          offline={!online}
        />
      </div>
    )
  }

  const site =
    supervision.siteLatitude != null && supervision.siteLongitude != null
      ? {
          lat: supervision.siteLatitude,
          lng: supervision.siteLongitude,
          name: supervision.siteName,
        }
      : null

  if (supervision.checkInAt == null) {
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
        confirmLabel={fichaje.view.poorSignal ? 'Fichar igual' : undefined}
      >
        <GeoFichajePanel
          fichaje={fichaje}
          site={site}
          busy={checkIn.isPending}
        />
      </RegisterStartScreen>
    )
  }

  return (
    <FinishStep
      supervision={supervision}
      onConfirm={() => void handleCheckOut()}
      busy={checkOut.isPending}
      error={error}
      offline={!online}
      fichaje={fichaje}
      site={site}
    />
  )
}

function FinishStep({
  supervision,
  onConfirm,
  busy,
  error,
  offline,
  fichaje,
  site,
}: {
  supervision: MySupervision
  onConfirm: () => void
  busy: boolean
  error: string | null
  offline: boolean
  fichaje: GeoFichaje
  site: { lat: number; lng: number; name: string } | null
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

      <GeoFichajePanel fichaje={fichaje} site={site} busy={busy} />

      <LazyShiftMediaSection
        shiftId={supervision.shiftId}
        counts={{
          photos: supervision.myPhotosCount,
          videos: supervision.myVideosCount,
        }}
        requiresPhotos={supervision.requiresPhotos}
        photosNotAllowed={supervision.photosNotAllowed}
        startsAt={supervision.startsAt}
        endsAt={supervision.endsAt}
      />

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
        {fichaje.view.poorSignal ? 'Fichar igual' : 'Registrar fin'}
      </Button>
    </div>
  )
}
