import { Link, useParams } from 'react-router'
import { PlayCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { PersonCell } from '@/components/PersonCell'
import { TaskList } from '@/components/TaskList'
import { StatusBadge } from '@/components/status'
import { formatTime } from '@/lib/format'
import {
  useMySupervisionQuery,
  useSupervisionShiftTasksQuery,
  useVigentRatingCriteriaQuery,
  type RatingCriterion,
  type SupervisedEmployee,
} from '@/api/mySupervisions'
import {
  SiteInfo,
  type SiteInfoData,
} from '@/features/sites/components/SiteInfo'

/**
 * SUP-03 · Detalle de la supervisión (MOB-SUP-004, `05` fila SUP-03, `06`
 * sección 12): cliente, sede (reusa `SiteInfo`, SITE-010, mismo componente
 * que EMP-04), franja, empleados asignados con su estado de asistencia e
 * inicio real, tareas del turno en solo lectura y la guía de criterios de
 * calificación. El botón "Registrar inicio de supervisión" lleva a SUP-04
 * sin importar si ya se registró el inicio (esa pantalla decide qué mostrar
 * según el estado); no se ofrece con la supervisión ya cerrada o cancelada.
 *
 * Los criterios que se muestran son los guardados al iniciar
 * (`criteriaSnapshot`, P-087) si la supervisión ya empezó, o los vigentes
 * ahora si todavía no (`useVigentRatingCriteriaQuery`) -- una guía de texto,
 * sin puntaje propio (P-080): calificar es SUP-05, de P15.5.
 */
export default function SupervisionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const {
    data: supervision,
    isLoading,
    isError,
  } = useMySupervisionQuery(id ?? '')
  const { data: tasks } = useSupervisionShiftTasksQuery(
    supervision?.shiftId ?? '',
  )
  const { data: vigentCriteria } = useVigentRatingCriteriaQuery()

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

  const siteInfo: SiteInfoData = {
    address: supervision.siteAddress ?? supervision.siteName,
    city: supervision.siteCity,
    latitude: supervision.siteLatitude,
    longitude: supervision.siteLongitude,
    contactName: supervision.siteContactName,
    contactPhone: supervision.siteContactPhone,
    accessInstructions: supervision.accessInstructions,
    buildingHours: supervision.buildingHours,
    phoneRestricted: supervision.phoneRestricted,
    photosNotAllowed: supervision.photosNotAllowed,
    restrictionsNotes: supervision.restrictionsNotes,
  }

  const criteria = supervision.criteriaSnapshot ?? vigentCriteria ?? []
  const canRegister = ['assigned', 'in_progress'].includes(supervision.status)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="items-start justify-between">
          <div className="min-w-0">
            <CardTitle>{supervision.clientName}</CardTitle>
            <p className="text-[12px] text-text-3">{supervision.siteName}</p>
          </div>
          <StatusBadge domain="supervision" status={supervision.status} />
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-text-2">
            {formatTimeOfDay(supervision.startTime)}–
            {formatTimeOfDay(supervision.endTime)}
          </p>
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
          <CardTitle>Empleados a supervisar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {supervision.assignedEmployees.length === 0 ? (
            <p className="text-[12.5px] text-text-3">
              Este turno no tiene empleados asignados.
            </p>
          ) : (
            supervision.assignedEmployees.map((employee) => (
              <EmployeeRow key={employee.employeeId} employee={employee} />
            ))
          )}
        </CardContent>
      </Card>

      {tasks && tasks.length > 0 && (
        <Card variant="flush">
          <CardHeader>
            <CardTitle>Tareas del turno</CardTitle>
          </CardHeader>
          <CardContent className="in-data-[variant=flush]:px-[14px]">
            <TaskList
              tasks={tasks.map((task) => ({
                id: task.id,
                title: task.title,
                description: task.description ?? undefined,
                status: task.status,
                isRequired: task.isRequired,
                notDoneReason: task.notDoneReason ?? undefined,
              }))}
              readOnly
            />
          </CardContent>
        </Card>
      )}

      {criteria.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Criterios de calificación</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {criteria.map((criterion) => (
              <CriterionDisclosure key={criterion.id} criterion={criterion} />
            ))}
          </CardContent>
        </Card>
      )}

      {canRegister && (
        <Button asChild size="mobile" className="mt-2">
          <Link to={`/sup/supervisiones/${supervision.id}/registro`}>
            <PlayCircle aria-hidden="true" />
            Registrar inicio de supervisión
          </Link>
        </Button>
      )}
    </div>
  )
}

function EmployeeRow({ employee }: { employee: SupervisedEmployee }) {
  const name = `${employee.firstName} ${employee.lastName}`.trim()
  const subtitle =
    employee.checkInAt != null
      ? `Inicio: ${formatTime(employee.checkInAt)}`
      : undefined
  return (
    <div className="flex items-center justify-between gap-2">
      <PersonCell id={employee.employeeId} name={name} subtitle={subtitle} />
      <StatusBadge domain="assignment" status={employee.status} />
    </div>
  )
}

/**
 * Un criterio por vez, con `<details>` nativo (accesible por teclado y con
 * lector de pantalla sin nada aparte): el design system no define un
 * componente de acordeón propio para esta guía (`07_Design_System.md`
 * sección 4 solo define `StarRating` para SUP-05), así que se resuelve con
 * el elemento semántico del navegador en vez de armar uno nuevo.
 */
function CriterionDisclosure({ criterion }: { criterion: RatingCriterion }) {
  return (
    <details className="rounded-lg border border-border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 py-[9px] text-[13px] font-semibold text-text">
        {criterion.title}
      </summary>
      {criterion.description && (
        <p className="border-t border-border px-3 py-[9px] text-[12px] text-text-2">
          {criterion.description}
        </p>
      )}
    </details>
  )
}

/** Mismo criterio que el resto de la vía: `"HH:MM:SS"` es hora de pared, no un instante. */
function formatTimeOfDay(time: string): string {
  return time.slice(0, 5)
}
