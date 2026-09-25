import { useState } from 'react'
import { Link } from 'react-router'
import {
  CalendarClock,
  ClipboardList,
  Pencil,
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
import type { ShiftDetailAssignment } from '@/api/assignments'
import {
  canManageAssignments,
  canManageAssignmentsAfterStart,
} from '@/features/planning/permissions'
import { useShiftDetailQuery } from '@/features/planning/queries'
import { AssignEmployeeSheet } from './AssignEmployeeSheet'
import { AssignmentTimeDialog } from './AssignmentTimeDialog'
import { RemoveAssignmentDialog } from './RemoveAssignmentDialog'
import { ShiftDetailsDialog } from './ShiftDetailsDialog'

/**
 * ADM-06 "Detalle del turno" (ASSIGN-011, `05` línea 40): cabecera, dotación
 * (con edición ASSIGN-013), asignaciones vigentes (con asignar/quitar/franja
 * propia), tareas y supervisiones en lectura (el alta es F12/F15) y notas
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

  const shiftQuery = useShiftDetailQuery(shiftId)

  const [isAssignOpen, setAssignOpen] = useState(false)
  const [isDetailsOpen, setDetailsOpen] = useState(false)
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

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold text-text">
            {shift.clientName} · {shift.siteName}
          </h2>
          <StatusBadge domain="shift" status={shift.status} />
        </div>
        <p className="text-[12.5px] text-text-3 capitalize">
          {formatDateOnly(shift.shiftDate)} · {shift.startTime.slice(0, 5)}–
          {shift.endTime.slice(0, 5)}
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
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
              >
                <PersonCell
                  id={assignment.employeeId}
                  name={`${assignment.employeeFirstName} ${assignment.employeeLastName}`}
                  subtitle={
                    assignment.startTime && assignment.endTime
                      ? `Franja propia: ${assignment.startTime.slice(0, 5)}–${assignment.endTime.slice(0, 5)}`
                      : `Franja del turno: ${shift.startTime.slice(0, 5)}–${shift.endTime.slice(0, 5)}`
                  }
                />
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge domain="assignment" status={assignment.status} />
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
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text">
          <ClipboardList aria-hidden="true" className="size-4 text-text-3" />
          Tareas
        </h3>
        {shift.tasks.length === 0 ? (
          <p className="text-[12px] text-text-3">
            Este turno no tiene un checklist copiado.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shift.tasks.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border p-3"
              >
                <span className="text-[12.5px] text-text">
                  {task.title}
                  {task.isRequired && (
                    <span className="text-text-3"> · obligatoria</span>
                  )}
                </span>
                <StatusBadge domain="task" status={task.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text">
          <ShieldCheck aria-hidden="true" className="size-4 text-text-3" />
          Supervisiones
        </h3>
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
                <PersonCell
                  id={supervision.supervisorId}
                  name={`${supervision.supervisorFirstName} ${supervision.supervisorLastName}`}
                />
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
          open={timeTarget != null}
          onOpenChange={(open) => {
            if (!open) {
              setTimeTarget(null)
            }
          }}
        />
      )}
    </div>
  )
}

export { ShiftDetail }
