import { useState } from 'react'
import { Link } from 'react-router'
import {
  CalendarClock,
  ClipboardList,
  Pencil,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { PersonCell } from '@/components/PersonCell'
import { StatusBadge } from '@/components/status'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import type { ShiftDetailAssignment } from '@/api/assignments'
import { canEditChecklists } from '@/features/checklists/permissions'
import { AssignmentAttendanceDetail } from '@/features/attendance/components/AssignmentAttendanceDetail'
import { canManageAttendance } from '@/features/attendance/permissions'
import {
  useAttendanceTimelineQuery,
  useAssignmentsAttendanceQuery,
  usePeopleNamesQuery,
} from '@/features/attendance/queries'
import {
  canManageAssignments,
  canManageAssignmentsAfterStart,
  canManageTasks,
} from '@/features/planning/permissions'
import { useShiftDetailQuery } from '@/features/planning/queries'
import { canManageSupervisions } from '@/features/supervisions/permissions'
import { CancelShiftAction } from '@/features/shifts/components/CancelShiftAction'
import { formatShiftRange } from '@/features/shifts/openEnded'
import { AdminTaskList } from './AdminTaskList'
import { AssignEmployeeSheet } from './AssignEmployeeSheet'
import { AssignmentTimeDialog } from './AssignmentTimeDialog'
import { ReloadTasksDialog } from './ReloadTasksDialog'
import { RemoveAssignmentDialog } from './RemoveAssignmentDialog'
import { ShiftDetailsDialog } from './ShiftDetailsDialog'

/**
 * ADM-06 "Detalle del turno" (ASSIGN-011, `05` línea 40): cabecera, dotación
 * (con edición ASSIGN-013), asignaciones vigentes (con asignar/quitar/franja
 * propia), tareas, supervisiones (lista con botón "Asignar supervisión",
 * SUP-012, `05` línea 40: "assign_supervision (ADM-14)") y notas
 * administrativas. `ShiftDetailPage` decide si esto se ve en un drawer o en
 * una página completa (ASSIGN-014); acá el contenido es el mismo para las
 * dos variantes.
 */
interface ShiftDetailProps {
  shiftId: string
}

function ShiftDetail({ shiftId }: ShiftDetailProps) {
  const auth = useAuth()
  const actor = { roles: auth.roles, capabilities: auth.capabilities }
  const canManage = canManageAssignments(actor)
  const canManageAfterStart = canManageAssignmentsAfterStart(actor)
  const canEditTasks = canManageTasks(actor)
  const canReloadChecklist = canEditChecklists(actor)
  const canManageAttendanceNow = canManageAttendance(actor)
  const canAssignSupervision = canManageSupervisions(actor)

  const shiftQuery = useShiftDetailQuery(shiftId)
  // Inicio y fin reales, quién y cómo se registraron, y los avisos
  // (ATT-014, ABS-006): se piden en cuanto se conocen los ids de las
  // asignaciones vigentes, sin esperar a los primeros `return` de abajo
  // (las reglas de hooks no permiten llamarlos condicionalmente).
  const assignmentIds = shiftQuery.data?.assignments.map((a) => a.id) ?? []
  const attendanceQuery = useAssignmentsAttendanceQuery(assignmentIds)
  const timelineQuery = useAttendanceTimelineQuery(assignmentIds)
  const recordedByIds = (attendanceQuery.data ?? []).flatMap((row) =>
    [row.checkInRecordedBy, row.checkOutRecordedBy].filter(
      (id): id is string => id != null,
    ),
  )
  const reportedByIds = Array.from(timelineQuery.data?.values() ?? []).flatMap(
    (events) =>
      events
        .filter((event) => event.source === 'admin')
        .map((event) => event.reportedBy)
        .filter((id): id is string => id != null),
  )
  const peopleNamesQuery = usePeopleNamesQuery([
    ...recordedByIds,
    ...reportedByIds,
  ])

  const [isAssignOpen, setAssignOpen] = useState(false)
  const [isDetailsOpen, setDetailsOpen] = useState(false)
  const [isReloadOpen, setReloadOpen] = useState(false)
  const [removeTarget, setRemoveTarget] =
    useState<ShiftDetailAssignment | null>(null)
  const [timeTarget, setTimeTarget] = useState<ShiftDetailAssignment | null>(
    null,
  )

  if (shiftQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    )
  }

  const shift = shiftQuery.data
  if (!shift) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No encontramos este turno"
        description="Puede que se haya movido o que el enlace esté roto."
      />
    )
  }

  const shiftStarted =
    shift.startsAt != null && new Date() >= new Date(shift.startsAt)
  // "Después del inicio del turno" (06 sección 8) hace falta manage_attendance
  // además de O/A -- la interfaz lo explica en vez de dejar que la RPC falle
  // sin contexto (regla del encargo).
  const canAssignNow = canManage && (!shiftStarted || canManageAfterStart)
  const isEditable =
    shift.status !== 'cancelled' && shift.status !== 'completed'
  const remainingSlots = shift.requiredStaff - shift.assignments.length
  // AJ2-09: «Sin salida» como en asistencia: presente en un turno «A terminar»
  // sin fin propio, con el día ya terminado.
  const isNoCheckout = (assignment: ShiftDetailAssignment) =>
    assignment.status === 'present' &&
    shift.openEnded &&
    assignment.endTime == null &&
    shift.shiftDate < todayInBuenosAires()
  // "Solo en turnos no empezados" (regla del encargo): `reload_shift_tasks`
  // (0025_rpc_tasks.sql) exige `status in (scheduled, assigned)`.
  const canReloadTasksNow =
    canReloadChecklist &&
    (shift.status === 'scheduled' || shift.status === 'assigned')

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold text-text">
            {shift.clientName} · {shift.siteName}
          </h2>
          <StatusBadge domain="shift" status={shift.status} />
        </div>
        <p className="text-[12.5px] text-text-3">
          <span className="capitalize">{formatDateOnly(shift.shiftDate)}</span>{' '}
          · {formatShiftRange(shift.startTime, shift.endTime, shift.openEnded)}
          {shift.siteCity ? ` · ${shift.siteCity}` : ''}
        </p>
        <p className="text-[11.5px] text-text-3">
          Origen: {shift.fromService ? 'Servicio recurrente' : 'Turno puntual'}
        </p>
        {isEditable && canManage && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild variant="ghost" size="sm" icon={Pencil}>
              <Link to={`/admin/turnos/${shift.id}/editar`}>Editar franja</Link>
            </Button>
          </div>
        )}
        {shift.status === 'completed' && shift.openEnded && canManage && (
          // AJ2-10: a un turno «A terminar» finalizado todavía se le puede poner la hora de fin.
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild variant="ghost" size="sm" icon={Pencil}>
              <Link to={`/admin/turnos/${shift.id}/editar`}>
                Poner hora de fin
              </Link>
            </Button>
          </div>
        )}
        <CancelShiftAction shift={shift} />
      </div>

      {shiftStarted && canManage && !canManageAfterStart && (
        <Alert variant="info">
          <AlertDescription>
            El turno ya empezó: para asignar o quitar personal hace falta el
            permiso de asistencia. Pedíselo a la dueña.
          </AlertDescription>
        </Alert>
      )}

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text">
            <Users aria-hidden="true" className="size-4 text-text-3" />
            Dotación: {shift.assignments.length}/{shift.requiredStaff}
          </h3>
          <div className="flex gap-2">
            {isEditable && canManage && (
              <Button
                variant="ghost"
                size="sm"
                icon={Pencil}
                onClick={() => setDetailsOpen(true)}
              >
                Editar dotación y notas
              </Button>
            )}
            {isEditable && (
              <Button
                size="sm"
                icon={UserPlus}
                disabled={!canAssignNow || remainingSlots <= 0}
                onClick={() => setAssignOpen(true)}
              >
                Asignar empleado
              </Button>
            )}
          </div>
        </div>
        {isEditable && remainingSlots <= 0 && (
          <p className="text-[11.5px] text-text-3">
            La dotación ya está completa. Para sumar a alguien más, primero
            aumentá la dotación.
          </p>
        )}

        {shift.assignments.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Todavía no hay nadie asignado"
            description="Usá «Asignar empleado» para cubrir este turno."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {shift.assignments.map((assignment) => (
              <li
                key={assignment.id}
                className="flex flex-col gap-2 rounded-md border border-border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <PersonCell
                    id={assignment.employeeId}
                    name={`${assignment.employeeFirstName} ${assignment.employeeLastName}`}
                    subtitle={
                      assignment.startTime && assignment.endTime
                        ? `Franja propia: ${formatShiftRange(assignment.startTime, assignment.endTime, false)}`
                        : shift.openEnded && assignment.startTime
                          ? `Franja propia: ${formatShiftRange(assignment.startTime, null, true)}`
                          : `Franja del turno: ${formatShiftRange(shift.startTime, shift.endTime, shift.openEnded)}`
                    }
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      domain="assignment"
                      status={
                        isNoCheckout(assignment)
                          ? 'no_checkout'
                          : assignment.status
                      }
                    />
                    {canAssignNow && isEditable && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setTimeTarget(assignment)}
                        >
                          Franja propia
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRemoveTarget(assignment)}
                        >
                          Quitar
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <AssignmentAttendanceDetail
                  assignmentId={assignment.id}
                  employeeName={`${assignment.employeeFirstName} ${assignment.employeeLastName}`}
                  shiftDate={shift.shiftDate}
                  attendance={attendanceQuery.data?.find(
                    (row) => row.id === assignment.id,
                  )}
                  events={timelineQuery.data?.get(assignment.id) ?? []}
                  peopleNames={peopleNamesQuery.data ?? new Map()}
                  canManage={canManageAttendanceNow}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text">
            <ClipboardList aria-hidden="true" className="size-4 text-text-3" />
            Tareas
          </h3>
          {canReloadTasksNow && shift.tasks.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              icon={RefreshCw}
              onClick={() => setReloadOpen(true)}
            >
              Recargar tareas
            </Button>
          )}
        </div>
        {shift.tasks.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Este turno no tiene tareas cargadas"
            description={
              canReloadTasksNow
                ? 'Puede ser que se haya creado antes de que existiera una plantilla de tareas. Usá «Recargar tareas» para copiarlas ahora.'
                : 'Puede ser que se haya creado antes de que existiera una plantilla de tareas para este cliente o esta sede.'
            }
            action={
              canReloadTasksNow ? (
                <Button size="sm" onClick={() => setReloadOpen(true)}>
                  Recargar tareas
                </Button>
              ) : undefined
            }
          />
        ) : (
          <AdminTaskList tasks={shift.tasks} canManage={canEditTasks} />
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text">
            <ShieldCheck aria-hidden="true" className="size-4 text-text-3" />
            Supervisiones
          </h3>
          {isEditable && canAssignSupervision && (
            <Button asChild variant="ghost" size="sm" icon={ShieldCheck}>
              <Link
                to="/admin/supervisiones/nueva"
                state={{ shiftId: shift.id, shiftDate: shift.shiftDate }}
              >
                Asignar supervisión
              </Link>
            </Button>
          )}
        </div>
        {shift.supervisions.length === 0 ? (
          <p className="text-[12px] text-text-3">
            Este turno no tiene supervisión asignada.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shift.supervisions.map((supervision) => (
              <li
                key={supervision.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border p-3"
              >
                <Link
                  to={`/admin/supervisiones/${supervision.id}`}
                  className="flex min-h-11 min-w-0 items-center"
                >
                  <PersonCell
                    id={supervision.supervisorId}
                    name={`${supervision.supervisorFirstName} ${supervision.supervisorLastName}`}
                  />
                </Link>
                <StatusBadge domain="supervision" status={supervision.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {shift.notes && (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5">
          <h3 className="text-[13px] font-semibold text-text">
            Notas administrativas
          </h3>
          <p className="text-[12.5px] whitespace-pre-wrap text-text-2">
            {shift.notes}
          </p>
        </section>
      )}

      {canManage && (
        <AssignEmployeeSheet
          shiftId={shift.id}
          clientId={shift.clientId}
          shiftDate={shift.shiftDate}
          shiftStartTime={shift.startTime}
          shiftEndTime={shift.endTime}
          shiftOpenEnded={shift.openEnded}
          excludeEmployeeIds={shift.assignments.map((a) => a.employeeId)}
          open={isAssignOpen}
          onOpenChange={setAssignOpen}
        />
      )}

      {canManage && (
        <ShiftDetailsDialog
          shiftId={shift.id}
          currentRequiredStaff={shift.requiredStaff}
          currentNotes={shift.notes}
          open={isDetailsOpen}
          onOpenChange={setDetailsOpen}
        />
      )}

      {removeTarget && (
        <RemoveAssignmentDialog
          assignmentId={removeTarget.id}
          employeeName={`${removeTarget.employeeFirstName} ${removeTarget.employeeLastName}`}
          open={removeTarget != null}
          onOpenChange={(open) => {
            if (!open) {
              setRemoveTarget(null)
            }
          }}
        />
      )}

      {timeTarget && (
        <AssignmentTimeDialog
          assignmentId={timeTarget.id}
          employeeName={`${timeTarget.employeeFirstName} ${timeTarget.employeeLastName}`}
          currentStartTime={timeTarget.startTime}
          currentEndTime={timeTarget.endTime}
          shiftOpenEnded={shift.openEnded}
          open={timeTarget != null}
          onOpenChange={(open) => {
            if (!open) {
              setTimeTarget(null)
            }
          }}
        />
      )}

      {canReloadTasksNow && (
        <ReloadTasksDialog
          shiftId={shift.id}
          open={isReloadOpen}
          onOpenChange={setReloadOpen}
        />
      )}
    </div>
  )
}

export { ShiftDetail }
