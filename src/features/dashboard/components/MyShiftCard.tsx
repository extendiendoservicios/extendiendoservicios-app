import { Link } from 'react-router'
import { Fingerprint } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { MyDayAssignment } from '@/api/myDay'
import { useHasRole } from '@/features/auth/useHasRole'
import { AssignmentStatusBadge } from '@/features/employee/components/AssignmentStatusBadge'
import { useMyDayQuery } from '@/features/employee/queries'
import { formatAssignmentRange } from '@/features/employee/shiftRange'
import { myShiftAction, type MyShiftAction } from '../myShift'

/**
 * Tarjeta «Mi turno» del Resumen (P29.3, OG-07): para quien entra al panel y
 * también tiene el rol `employee`. Muestra el servicio de hoy (sede, horario y
 * estado) y el botón de la huella. No duplica el fichaje: «Registrar inicio»
 * lleva a la pantalla de fichar de la app del empleado (consentimiento,
 * ubicación, validación de zona y resultado) y «Registrar fin» a la de
 * finalizar; las dos tienen «Volver al panel» (P29.2).
 */
function MyShiftCard() {
  const isEmployee = useHasRole('employee')
  if (!isEmployee) {
    return null
  }
  return <MyShiftCardContent />
}

function actionTarget(
  action: Exclude<MyShiftAction, 'none'>,
  assignment: MyDayAssignment,
): { to: string; label: string } {
  if (action === 'start') {
    return {
      to: `/app/fichar?asignacion=${assignment.assignmentId}`,
      label: 'Registrar inicio',
    }
  }
  return {
    to: `/app/en-curso/${assignment.assignmentId}/finalizar`,
    label: 'Registrar fin',
  }
}

function MyShiftCardContent() {
  const query = useMyDayQuery()
  const today = (query.data ?? []).filter(
    (assignment) =>
      assignment.isToday && assignment.shiftStatus !== 'cancelled',
  )

  // Sin asignación hoy no hay nada que mostrar (no es un error).
  if (query.isLoading || query.isError || today.length === 0) {
    return null
  }

  return (
    <section aria-label="Mi turno" className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold text-text">Mi turno</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {today.map((assignment) => {
          const action = myShiftAction(assignment)
          const target =
            action === 'none' ? null : actionTarget(action, assignment)
          return (
            <Card key={assignment.assignmentId} variant="hero">
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-text">
                      {assignment.clientName}
                    </p>
                    <p className="truncate text-[12px] text-text-3">
                      {assignment.siteName}
                    </p>
                  </div>
                  <AssignmentStatusBadge assignment={assignment} />
                </div>
                <p className="text-[13px] font-semibold text-text-2">
                  {formatAssignmentRange(assignment)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {target && (
                    <Button asChild size="sm">
                      <Link to={target.to}>
                        <Fingerprint aria-hidden="true" className="size-4" />
                        {target.label}
                      </Link>
                    </Button>
                  )}
                  {assignment.checkInAt != null &&
                    assignment.checkOutAt == null && (
                      <Button asChild size="sm" variant="ghost">
                        <Link to={`/app/en-curso/${assignment.assignmentId}`}>
                          Abrir mi servicio
                        </Link>
                      </Button>
                    )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

export { MyShiftCard }
