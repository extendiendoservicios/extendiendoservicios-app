import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { CheckCircle2, Lock, Star, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PersonCell } from '@/components/PersonCell'
import { StarRating } from '@/components/StarRating'
import { TaskList } from '@/components/TaskList'
import { StatusBadge } from '@/components/status'
import { formatTime } from '@/lib/format'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  canRateNow,
  isRatingWindowClosed,
  useDiscardSupervisionMutation,
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
import { LazyShiftMediaSection } from '@/features/employee/components/LazyShiftMediaSection'
import { AttendanceMarkRow } from '@/features/employee/components/AttendanceMarkRow'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { coordinatorErrorMessage } from '@/features/coordinator/errors'
import { pendingRatings } from '@/features/coordinator/ratings'

/**
 * SUP-04 · Supervisión (P24.2; antes «Detalle de la supervisión», MOB-SUP-004,
 * `05` fila SUP-03): cliente, sede (reusa `SiteInfo`, SITE-010, mismo
 * componente que EMP-04), franja, empleados del turno con su estado de
 * asistencia e inicio real, tareas del turno en solo lectura y la guía de
 * criterios de calificación.
 *
 * El inicio ya no se registra acá: «Supervisar» (SUP-03) lo hace al tomar el
 * turno (CJ-26) y el fin lo registra «Cerrar» (SUP-06, `complete_supervision`).
 * Esta pantalla ofrece:
 * - «Descartar» (CJ-27) mientras no haya calificado a nadie: queda cancelada y
 *   puede volver a tomar el turno.
 * - «Cerrar supervisión», deshabilitado mientras falte calificar a alguien
 *   (CJ-10, CJ-28), con la lista de los que faltan.
 *
 * Los criterios que se muestran son los guardados al iniciar
 * (`criteriaSnapshot`, P-087) o, si todavía no hay, los vigentes ahora -- una
 * guía de texto, sin puntaje propio (P-080).
 *
 * Cada empleado con inicio registrado lleva su acceso a calificar (SUP-05)
 * salvo que sea el propio coordinador trabajando también como empleado del
 * turno (CB-13, «Vos») o que el plazo de P-083 ya haya cerrado
 * (MOB-SUP-011). Los ausentes no se califican (CJ-28).
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
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const discard = useDiscardSupervisionMutation()
  const [discardOpen, setDiscardOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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
  const isOpen = supervision.status === 'in_progress'
  // «Sin cerrar» (CJ-31): la jornada se cerró sola con esta supervisión abierta.
  const unclosed = isOpen && supervision.checkOutAt != null
  const pending =
    assignments && ratings
      ? pendingRatings(supervision, assignments, ratings, auth.userId)
      : null
  const canDiscard =
    isOpen && !unclosed && ratings != null && ratings.length === 0
  const closeBlocked = pending == null || pending.length > 0

  async function handleDiscard() {
    setActionError(null)
    try {
      await discard.mutateAsync({ supervisionId: supervision!.id })
      setDiscardOpen(false)
      void navigate('/sup', { replace: true })
    } catch (mutationError) {
      setDiscardOpen(false)
      setActionError(
        coordinatorErrorMessage(
          mutationError,
          'No pudimos descartar la supervisión. Probá de nuevo.',
        ),
      )
    }
  }

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
          {/* Módulo B1 (B-07, B-19): cómo quedó validado cada fichaje contra la sede. */}
          <AttendanceMarkRow
            label="Ubicación del inicio"
            at={supervision.checkInAt}
            geo={supervision.checkInGeo}
            hideTime
          />
          <AttendanceMarkRow
            label="Ubicación del fin"
            at={supervision.checkOutAt}
            geo={supervision.checkOutGeo}
            hideTime
          />
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

      {/* Módulo H (P21.3): fotos y videos propios del turno supervisado. La
          supervisión puede estar asignada, en curso o completada; cancelada o
          no realizada no (`begin_shift_media` de 0047 rechaza con
          NOT_SHIFT_PARTICIPANT). */}
      {(supervision.status === 'in_progress' ||
        supervision.status === 'completed') && (
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
      )}

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

      {unclosed && (
        <Alert variant="warn">
          <AlertDescription>
            Esta supervisión quedó sin cerrar cuando se cerró tu jornada. La
            administración la va a revisar.
          </AlertDescription>
        </Alert>
      )}

      {isOpen && !unclosed && pending && pending.length > 0 && (
        <Alert variant="warn">
          <AlertDescription>
            Para cerrar la supervisión falta calificar a:{' '}
            {pending.map((p) => p.name).join(', ')}.
          </AlertDescription>
        </Alert>
      )}
      {actionError && (
        <Alert variant="crit">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {isOpen && !unclosed && (
        <div className="mt-2 flex flex-col gap-[9px]">
          {closeBlocked ? (
            <Button size="mobile" disabled>
              <CheckCircle2 aria-hidden="true" />
              Cerrar supervisión
            </Button>
          ) : (
            <Button asChild size="mobile">
              <Link to={`/sup/supervisiones/${supervision.id}/cerrar`}>
                <CheckCircle2 aria-hidden="true" />
                Cerrar supervisión
              </Link>
            </Button>
          )}
          {canDiscard && (
            <Button
              size="mobile"
              variant="ghost"
              onClick={() => setDiscardOpen(true)}
              disabled={!online}
            >
              <Trash2 aria-hidden="true" />
              Descartar
            </Button>
          )}
        </div>
      )}

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>¿Descartar la supervisión?</DialogTitle>
            <DialogDescription>
              Usalo si la empezaste por error. Queda cancelada y podés volver a
              tomar este turno. Solo se puede si todavía no calificaste a nadie.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              size="mobile"
              variant="destructive"
              onClick={() => void handleDiscard()}
              loading={discard.isPending}
              disabled={!online || discard.isPending}
            >
              Descartar supervisión
            </Button>
            <Button
              size="mobile"
              variant="ghost"
              onClick={() => setDiscardOpen(false)}
              disabled={discard.isPending}
            >
              Volver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
        ) : canRate &&
          assignmentId &&
          (employee.checkInAt != null || rating) ? (
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
