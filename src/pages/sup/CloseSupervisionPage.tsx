import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ActionBar } from '@/app/shells/ActionBar'
import { useAuth } from '@/features/auth/AuthProvider'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { useLocationConsent } from '@/features/employee/useLocationConsent'
import { useGeoFichaje } from '@/features/employee/useGeoFichaje'
import { GeoFichajePanel } from '@/features/employee/components/GeoFichajePanel'
import { LocationConsentGate } from '@/features/coordinator/components/LocationConsentGate'
import { coordinatorErrorMessage } from '@/features/coordinator/errors'
import { employeesToRate, pendingRatings } from '@/features/coordinator/ratings'
import {
  useCompleteSupervisionMutation,
  useMySupervisionQuery,
  useSupervisionAssignmentsQuery,
  useSupervisionRatingsQuery,
} from '@/api/mySupervisions'

/** Estados en los que ya no hay nada para cerrar en esta pantalla. */
const CLOSED_STATUSES = new Set(['completed', 'not_done', 'cancelled'])

/**
 * SUP-06 · Cerrar supervisión (P24.2, `05` fila SUP-06, CJ-10, CJ-20, CJ-28):
 * nota general opcional y «Cerrar supervisión» (`complete_supervision`), que
 * registra el fin con la posición. Solo se puede cerrar si ya calificó a todos
 * los empleados del turno con inicio registrado: mientras falte alguien, el
 * botón queda deshabilitado y la pantalla lista a quién falta, con un acceso a
 * calificar. Los ausentes no se califican y el propio coordinador, si también
 * está asignado como empleado, queda fuera del requisito.
 *
 * Ya no existe «No se pudo realizar» (`mark_supervision_not_done` está
 * revocada, CJ-26): si la empezó por error, la descarta desde SUP-04 (CJ-27).
 *
 * La posición del fin sigue el flujo de B1: consentimiento primero, panel en
 * vivo con la sede y, si no hay consentimiento o señal, el cierre se registra
 * igual sin coordenadas.
 */
export default function CloseSupervisionPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const auth = useAuth()
  const online = useOnlineStatus()
  const consent = useLocationConsent()
  const {
    data: supervision,
    isLoading,
    isError,
  } = useMySupervisionQuery(id ?? '')
  const { data: assignments } = useSupervisionAssignmentsQuery(
    supervision?.shiftId ?? '',
  )
  const { data: ratings } = useSupervisionRatingsQuery(id ?? '')
  const complete = useCompleteSupervisionMutation()
  const [generalNotes, setGeneralNotes] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [consentOpen, setConsentOpen] = useState(false)
  // Al cerrar desde acá, la consulta se revalida con el estado nuevo antes
  // de `navigate('/sup')`: la guarda de abajo no debe mandarla al detalle.
  const [closing, setClosing] = useState(false)

  const fichaje = useGeoFichaje({
    enabled: consent.status === 'granted' && supervision != null,
    siteLatitude: supervision?.siteLatitude ?? null,
    siteLongitude: supervision?.siteLongitude ?? null,
    radiusM: supervision?.siteGeofenceRadiusM ?? null,
    maxAccuracyM: supervision?.geofenceMaxAccuracyM ?? null,
  })

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
  if (CLOSED_STATUSES.has(supervision.status) && !closing) {
    return <Navigate to={`/sup/supervisiones/${supervision.id}`} replace />
  }

  const backLink = `/sup/supervisiones/${supervision.id}`
  const total = employeesToRate(supervision, auth.userId).length
  const pending =
    assignments && ratings
      ? pendingRatings(supervision, assignments, ratings, auth.userId)
      : null
  const missing = pending?.length ?? 0
  const blocked = pending == null || missing > 0
  const site =
    supervision.siteLatitude != null && supervision.siteLongitude != null
      ? {
          lat: supervision.siteLatitude,
          lng: supervision.siteLongitude,
          name: supervision.siteName,
        }
      : null

  async function handleComplete() {
    setSubmitError(null)
    if (consent.status === 'needs-consent') {
      setConsentOpen(true)
      return
    }
    setClosing(true)
    try {
      await complete.mutateAsync({
        supervisionId: supervision!.id,
        generalNotes: generalNotes || undefined,
        coords: fichaje.payload.coords,
        outsideReason: fichaje.payload.outsideReason,
      })
      void navigate('/sup', { replace: true })
    } catch (mutationError) {
      setClosing(false)
      setSubmitError(
        coordinatorErrorMessage(
          mutationError,
          'No pudimos cerrar la supervisión. Probá de nuevo.',
        ),
      )
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-1">
          <p className="text-[14px] font-semibold text-text">
            {supervision.clientName}
          </p>
          <p className="text-[12px] text-text-3">{supervision.siteName}</p>
          <p className="pt-1 text-[13px] text-text-2">
            Calificaste a {total - missing} de {total}{' '}
            {total === 1 ? 'empleado' : 'empleados'}.
          </p>
        </CardContent>
      </Card>

      {pending && missing > 0 && (
        <Alert variant="warn">
          <AlertDescription>
            <span className="block">
              Para cerrar tenés que calificar a todos los empleados del turno
              que iniciaron. Falta:
            </span>
            <ul className="mt-1 flex flex-col">
              {pending.map((person) => (
                <li key={person.employeeId}>
                  {person.assignmentId ? (
                    <Link
                      to={`/sup/supervisiones/${supervision.id}/calificar/${person.assignmentId}`}
                      className="flex min-h-11 items-center font-semibold underline underline-offset-2"
                    >
                      {person.name}
                    </Link>
                  ) : (
                    person.name
                  )}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Textarea
        mobile
        rows={3}
        value={generalNotes}
        onChange={(event) => setGeneralNotes(event.target.value)}
        placeholder="Nota general (opcional)…"
      />

      {consent.status === 'granted' && (
        <GeoFichajePanel
          fichaje={fichaje}
          site={site}
          busy={complete.isPending}
        />
      )}

      {submitError && (
        <Alert variant="crit">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}
      {!online && (
        <Alert variant="warn">
          <AlertDescription>
            Estás sin conexión. Conectate para poder guardar.
          </AlertDescription>
        </Alert>
      )}

      <ActionBar>
        <Button
          size="mobile"
          onClick={() => void handleComplete()}
          loading={complete.isPending}
          disabled={blocked || !online || complete.isPending}
        >
          {fichaje.view.poorSignal ? 'Cerrar igual' : 'Cerrar supervisión'}
        </Button>
        <Button
          asChild
          size="mobile"
          variant="ghost"
          disabled={complete.isPending}
        >
          <Link to={backLink}>Volver</Link>
        </Button>
      </ActionBar>

      <LocationConsentGate
        open={consentOpen}
        onCancel={() => setConsentOpen(false)}
        onResolved={() => setConsentOpen(false)}
      />
    </div>
  )
}
