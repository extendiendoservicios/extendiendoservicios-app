import { Link, useParams } from 'react-router'
import { Lock, PlayCircle, Star, StopCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { PersonCell } from '@/components/PersonCell'
import { StarRating } from '@/components/StarRating'
import { TaskList } from '@/components/TaskList'
import { StatusBadge } from '@/components/status'
import { formatTime } from '@/lib/format'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  canRateNow,
  isRatingWindowClosed,
  useMySupervisionQuery,
  useSupervisionAssignmentsQuery,
  useSupervisionRatingsQuery,
  useSupervisionShiftTasksQuery,
  useVigentRatingCriteriaQuery,
  type SupervisedEmployee,
  type SupervisionRating,
} from '@/api/mySupervisions'
import {
  SiteInfo,
  type SiteInfoData,
} from '@/features/sites/components/SiteInfo'
import { RatingCriteriaGuide } from '@/features/supervisions/components/RatingCriteriaGuide'
import { formatSupervisionRange } from '@/features/employee/shiftRange'

/**
 * SUP-03 · Detalle de la supervisión (MOB-SUP-004, `05` fila SUP-03, `06`
 * sección 12): cliente, sede (reusa `SiteInfo`, SITE-010, mismo componente
 * que EMP-04), franja, empleados asignados con su estado de asistencia e
 * inicio real, tareas del turno en solo lectura y la guía de criterios de
 * calificación. El botón lleva a SUP-04 y dice lo que falta: "Registrar
 * inicio" sin inicio, "Registrar fin" con inicio y sin fin, y no aparece con
 * los dos registrados (cerrar es SUP-06, P15.5) ni con la supervisión cerrada
 * o cancelada. La cabecera muestra las horas ya registradas.
 *
 * Los criterios que se muestran son los guardados al iniciar
 * (`criteriaSnapshot`, P-087) si la supervisión ya empezó, o los vigentes
 * ahora si todavía no (`useVigentRatingCriteriaQuery`) -- una guía de texto,
 * sin puntaje propio (P-080).
 *
 * P15.5 (MOB-SUP-006/007): cada empleado de la lista lleva su acceso a
 * calificar (SUP-05, con la calificación ya cargada si existe) salvo que
 * sea el propio supervisor trabajando también como empleado del turno
 * (CB-13, "Vos") o que el plazo de P-083 ya haya cerrado (MOB-SUP-011, no
 * se ofrece el acceso en vez de dejar que falle contra el servidor). El pie
 * ahora también ofrece "Cerrar supervisión" (SUP-06) mientras la
 * supervisión esté asignada o en curso, además de "Registrar inicio/fin"
 * cuando corresponda -- antes esta pantalla no ofrecía nada con los dos
 * registros hechos.
 */
export default function SupervisionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const auth = useAuth()
  const {
    data: supervision,
    isLoading,
    isError,
  } = useMySupervisionQuery(id ?? '')
  const { data: tasks } = useSupervisionShiftTasksQuery(
    supervision?.shiftId ?? '',
  )
  const { data: vigentCriteria } = useVigentRatingCriteriaQuery()
  const { data: assignments } = useSupervisionAssignmentsQuery(
    supervision?.shiftId ?? '',
  )
  const { data: ratings } = useSupervisionRatingsQuery(id ?? '')

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
  const isOpen = ['assigned', 'in_progress'].includes(supervision.status)
  const nextStep = !isOpen
    ? null
    : supervision.checkInAt == null
      ? 'start'
      : supervision.checkOutAt == null
        ? 'finish'
        : null
  // MOB-SUP-011: se anticipa el cierre de la ventana de P-083 acá para no
  // ofrecer el acceso a calificar cuando la RPC lo va a rechazar de todos
  // modos (RATING_WINDOW_CLOSED).
  const ratingWindowClosed = isRatingWindowClosed(supervision)
  const canRate = canRateNow(supervision)

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
            {formatSupervisionRange(supervision)}
          </p>
          {supervision.checkInAt && (
            <p className="text-[12px] text-text-3">
              Iniciada a las {formatTime(new Date(supervision.checkInAt))}
              {supervision.checkOutAt &&
                ` · Finalizada a las ${formatTime(new Date(supervision.checkOutAt))}`}
            </p>
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
          <CardTitle>Empleados a supervisar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {supervision.assignedEmployees.length === 0 ? (
            <p className="text-[12.5px] text-text-3">
              Este turno no tiene empleados asignados.
            </p>
          ) : (
            supervision.assignedEmployees.map((employee) => {
              const assignmentId = assignments?.find(
                (a) => a.employeeId === employee.employeeId,
              )?.assignmentId
              const rating = ratings?.find(
                (r) => r.assignmentId === assignmentId,
              )
              return (
                <EmployeeRow
                  key={employee.employeeId}
                  employee={employee}
                  supervisionId={supervision.id}
                  assignmentId={assignmentId}
                  rating={rating}
                  isSelf={employee.employeeId === auth.userId}
                  canRate={canRate}
                />
              )
            })
          )}
          {(supervision.status === 'in_progress' ||
            supervision.status === 'completed') &&
            ratingWindowClosed &&
            supervision.assignedEmployees.some(
              (employee) => employee.employeeId !== auth.userId,
            ) && (
              <p className="flex items-center gap-1 text-[11.5px] text-text-3">
                <Lock aria-hidden="true" className="size-3" />
                El plazo para calificar a este turno ya cerró.
              </p>
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
          <CardContent>
            <RatingCriteriaGuide criteria={criteria} />
          </CardContent>
        </Card>
      )}

      {nextStep && (
        <Button asChild size="mobile" className="mt-2">
          <Link to={`/sup/supervisiones/${supervision.id}/registro`}>
            {nextStep === 'start' ? (
              <>
                <PlayCircle aria-hidden="true" />
                Registrar inicio de supervisión
              </>
            ) : (
              <>
                <StopCircle aria-hidden="true" />
                Registrar fin de supervisión
              </>
            )}
          </Link>
        </Button>
      )}

      {/* MOB-SUP-007: antes esta pantalla no ofrecía nada con inicio y fin
          ya registrados; ahora "Cerrar supervisión" (SUP-06) queda
          disponible mientras la supervisión esté asignada o en curso -- no
          solo con los dos registros hechos, porque "marcar no realizada"
          (`mark_supervision_not_done`) no exige fin registrado, a
          diferencia de "completar" (`complete_supervision`,
          `CHECK_OUT_REQUIRED`); SUP-06 resuelve cuál de las dos ofrecer. */}
      {isOpen && (
        <Button
          asChild
          size="mobile"
          variant={nextStep ? 'ghost' : 'primary'}
          className={nextStep ? undefined : 'mt-2'}
        >
          <Link to={`/sup/supervisiones/${supervision.id}/cerrar`}>
            Cerrar supervisión
          </Link>
        </Button>
      )}
    </div>
  )
}

function EmployeeRow({
  employee,
  supervisionId,
  assignmentId,
  rating,
  isSelf,
  canRate,
}: {
  employee: SupervisedEmployee
  supervisionId: string
  assignmentId: string | undefined
  rating: SupervisionRating | undefined
  isSelf: boolean
  canRate: boolean
}) {
  const name = `${employee.firstName} ${employee.lastName}`.trim()
  const subtitle =
    employee.checkInAt != null
      ? `Inicio: ${formatTime(employee.checkInAt)}`
      : undefined
  return (
    <div className="flex items-center justify-between gap-2">
      <PersonCell id={employee.employeeId} name={name} subtitle={subtitle} />
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge domain="assignment" status={employee.status} />
        {isSelf ? (
          <span className="text-[11px] text-text-3">Vos</span>
        ) : canRate && assignmentId ? (
          <Link
            to={`/sup/supervisiones/${supervisionId}/calificar/${assignmentId}`}
            className="flex min-h-11 items-center gap-1 rounded-md px-1.5 text-[12px] font-semibold text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring"
          >
            {rating ? (
              <StarRating value={rating.score} readOnly size="sm" />
            ) : (
              <Star aria-hidden="true" className="size-4" />
            )}
            {rating ? 'Editar' : 'Calificar'}
          </Link>
        ) : rating ? (
          <StarRating value={rating.score} readOnly size="sm" />
        ) : null}
      </div>
    </div>
  )
}
