import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { PlayCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ActionBar } from '@/app/shells/ActionBar'
import { PersonCell } from '@/components/PersonCell'
import { StatusBadge } from '@/components/status'
import { formatTime } from '@/lib/format'
import type { AttendanceGeo } from '@/api/attendanceGeo'
import { useTakeSupervisionMutation } from '@/api/mySupervisions'
import { useTodayWorkdayQuery } from '@/api/myWorkdays'
import { useSupervisorTodayQuery } from '@/api/supervisorToday'
import {
  SiteInfo,
  type SiteInfoData,
} from '@/features/sites/components/SiteInfo'
import { formatSupervisionRange } from '@/features/employee/shiftRange'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { useLocationConsent } from '@/features/employee/useLocationConsent'
import { useGeoFichaje } from '@/features/employee/useGeoFichaje'
import { GeoFichajePanel } from '@/features/employee/components/GeoFichajePanel'
import { AttendanceResultScreen } from '@/features/employee/components/AttendanceResultScreen'
import { LocationConsentGate } from '@/features/coordinator/components/LocationConsentGate'
import { coordinatorErrorMessage } from '@/features/coordinator/errors'
import {
  SHIFT_STATE_LABELS,
  supervisorsLabels,
  takeSupervisionBlock,
} from '@/features/coordinator/shifts'

const STATE_VARIANTS = {
  in_progress: 'primary',
  pending: 'neutral',
  finished: 'success',
} as const

/**
 * SUP-03 · Detalle del turno (P24.2, CJ-02 a CJ-08, CJ-26, CJ-27): datos del
 * turno y de la sede, empleados asignados, quién más lo supervisa y el botón
 * «Supervisar», que registra el inicio de la supervisión con la posición en un
 * solo paso (`take_supervision`). El botón queda deshabilitado, con su motivo
 * a la vista, si no se cumple CJ-07 (jornada iniciada y sin pausa), CJ-08
 * (una supervisión abierta a la vez) o CJ-27 (una por turno).
 *
 * La posición sigue el flujo de B1: consentimiento primero, panel en vivo con
 * la sede y, si la persona no acepta o no hay señal, el inicio se registra
 * igual sin coordenadas. Después de registrar se muestra la hora y el
 * resultado que devolvió la base.
 */
export default function SupervisorShiftPage() {
  const { shiftId } = useParams<{ shiftId: string }>()
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const consent = useLocationConsent()
  const { data: shifts, isLoading, isError } = useSupervisorTodayQuery()
  const { data: workday } = useTodayWorkdayQuery()
  const take = useTakeSupervisionMutation()
  const [error, setError] = useState<string | null>(null)
  const [consentOpen, setConsentOpen] = useState(false)
  const [result, setResult] = useState<{
    supervisionId: string
    recordedAt: string
    geo: AttendanceGeo
  } | null>(null)

  const shift = shifts?.find((candidate) => candidate.shiftId === shiftId)
  // `workday` es `undefined` mientras carga y `null` si todavía no la inició.
  const block = shift ? takeSupervisionBlock(shift, workday) : null
  const canTake = shift != null && block == null

  const fichaje = useGeoFichaje({
    enabled: consent.status === 'granted' && canTake,
    siteLatitude: shift?.siteLatitude ?? null,
    siteLongitude: shift?.siteLongitude ?? null,
    radiusM: null,
    maxAccuracyM: null,
  })

  if (result && shift) {
    return (
      <AttendanceResultScreen
        title="Supervisión iniciada"
        recordedAt={result.recordedAt}
        geo={result.geo}
        heading={{ primary: shift.clientName, secondary: shift.siteName }}
        onContinue={() =>
          void navigate(`/sup/supervisiones/${result.supervisionId}`, {
            replace: true,
          })
        }
        continueLabel="Seguir con la supervisión"
      />
    )
  }

  if (isLoading || consent.loading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (isError || !shift) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No encontramos ese turno entre los de hoy. Volvé a Hoy e intentá de
          nuevo.
        </AlertDescription>
      </Alert>
    )
  }

  const siteInfo: SiteInfoData = {
    address: shift.siteAddress ?? shift.siteName,
    city: shift.siteCity,
    latitude: shift.siteLatitude,
    longitude: shift.siteLongitude,
    contactName: null,
    contactPhone: null,
    accessInstructions: null,
    buildingHours: null,
    phoneRestricted: false,
    photosNotAllowed: false,
    restrictionsNotes: null,
  }
  const site =
    shift.siteLatitude != null && shift.siteLongitude != null
      ? {
          lat: shift.siteLatitude,
          lng: shift.siteLongitude,
          name: shift.siteName,
        }
      : null
  const others = shift.supervisors.filter((s) => !s.isMe)
  const mine = shift.supervisors.find((s) => s.isMe)
  const myOpenSupervisionId =
    shift.mySupervisionStatus === 'in_progress' ? shift.mySupervisionId : null

  async function handleTake() {
    if (!shift) return
    setError(null)
    if (consent.status === 'needs-consent') {
      setConsentOpen(true)
      return
    }
    try {
      const taken = await take.mutateAsync({
        shiftId: shift.shiftId,
        coords: fichaje.payload.coords,
        outsideReason: fichaje.payload.outsideReason,
      })
      if (taken.checkIn.geo) {
        setResult({
          supervisionId: taken.supervisionId,
          recordedAt: taken.checkIn.recordedAt,
          geo: taken.checkIn.geo,
        })
      } else {
        void navigate(`/sup/supervisiones/${taken.supervisionId}`, {
          replace: true,
        })
      }
    } catch (mutationError) {
      setError(
        coordinatorErrorMessage(
          mutationError,
          'No pudimos iniciar la supervisión. Probá de nuevo.',
        ),
      )
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Card>
        <CardHeader className="items-start justify-between">
          <div className="min-w-0">
            <CardTitle>{shift.clientName}</CardTitle>
            <p className="text-[12px] text-text-3">{shift.siteName}</p>
          </div>
          <Badge variant={STATE_VARIANTS[shift.displayState]} dot>
            {SHIFT_STATE_LABELS[shift.displayState]}
          </Badge>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-text-2">
            {formatSupervisionRange({
              startTime: shift.startTime,
              endTime: shift.endTime,
              shiftOpenEnded: shift.openEnded,
            })}
          </p>
          {myOpenSupervisionId && (
            <Link
              to={`/sup/supervisiones/${myOpenSupervisionId}`}
              className="flex min-h-11 items-center text-[13px] font-semibold text-primary underline-offset-2 hover:underline"
            >
              Ir a mi supervisión
            </Link>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sede</CardTitle>
        </CardHeader>
        <CardContent>
          <SiteInfo site={siteInfo} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Empleados del turno</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {shift.assignedEmployees.length === 0 ? (
            <p className="text-[12.5px] text-text-3">
              Este turno no tiene empleados asignados.
            </p>
          ) : (
            shift.assignedEmployees.map((employee) => (
              <div
                key={employee.assignmentId}
                className="flex items-center justify-between gap-2"
              >
                <PersonCell
                  id={employee.employeeId}
                  name={`${employee.firstName} ${employee.lastName}`.trim()}
                  subtitle={
                    employee.checkInAt
                      ? `Inicio: ${formatTime(employee.checkInAt)}`
                      : undefined
                  }
                />
                <StatusBadge domain="assignment" status={employee.status} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quién más lo supervisa</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {others.length === 0 ? (
            <p className="text-[12.5px] text-text-3">
              Ningún otro coordinador lo supervisa por ahora.
            </p>
          ) : (
            supervisorsLabels({ ...shift, supervisors: others }, true).map(
              (label) => (
                <p key={label} className="text-[13px] text-text-2">
                  {label}
                </p>
              ),
            )
          )}
          {mine && (
            <p className="text-[12px] text-text-3">
              Vos{' '}
              {mine.status === 'in_progress'
                ? 'lo estás supervisando'
                : 'ya lo supervisaste'}
              .
            </p>
          )}
        </CardContent>
      </Card>

      {canTake && consent.status === 'granted' && (
        <GeoFichajePanel fichaje={fichaje} site={site} busy={take.isPending} />
      )}

      {error && (
        <Alert variant="crit">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!online && (
        <Alert variant="warn">
          <AlertDescription>
            Estás sin conexión. Conectate para poder iniciar la supervisión.
          </AlertDescription>
        </Alert>
      )}

      <ActionBar note={block ?? undefined}>
        <Button
          size="mobile"
          onClick={() => void handleTake()}
          loading={take.isPending}
          disabled={!canTake || !online || take.isPending}
        >
          <PlayCircle aria-hidden="true" />
          {fichaje.view.poorSignal ? 'Supervisar igual' : 'Supervisar'}
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
