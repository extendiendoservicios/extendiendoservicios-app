import { Link, useParams } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { TaskList } from '@/components/TaskList'
import { formatMinutes, formatTime } from '@/lib/format'
import { elapsedSeconds } from '@/features/employee/chronometer'
import { useMyDayQuery, useShiftTasksQuery } from '@/features/employee/queries'

/**
 * EMP-11 · Resumen del servicio (MOB-EMP-012, `05` fila EMP-11): el
 * comprobante del turno -- inicio, fin, duración, tareas (completadas, no
 * realizadas y pendientes) y la observación cargada. Accesible desde Hoy o
 * el detalle mientras la asignación siga en `v_my_day` (hoy o los próximos 7
 * días, P-093): no hay un historial propio en esta fase (F13; ver F14/F15
 * para asistencia administrativa e historial más largo).
 */
export default function SummaryPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const { data: myDay, isLoading } = useMyDayQuery()
  const assignment = myDay?.find((a) => a.assignmentId === assignmentId)
  const { data: tasks } = useShiftTasksQuery(assignment?.shiftId ?? '')

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (!assignment) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No encontramos ese servicio. Volvé a Hoy e intentá de nuevo.
        </AlertDescription>
      </Alert>
    )
  }

  const durationLabel =
    assignment.checkInAt && assignment.checkOutAt
      ? formatMinutes(
          Math.round(
            elapsedSeconds(
              assignment.checkInAt,
              new Date(assignment.checkOutAt),
            ) / 60,
          ),
        )
      : null

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{assignment.clientName}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-[6px]">
          <p className="text-[12px] text-text-3">{assignment.siteName}</p>
          <SummaryRow
            label="Inicio"
            value={
              assignment.checkInAt ? formatTime(assignment.checkInAt) : '—'
            }
          />
          <SummaryRow
            label="Fin"
            value={
              assignment.checkOutAt ? formatTime(assignment.checkOutAt) : '—'
            }
          />
          {durationLabel && (
            <SummaryRow label="Duración" value={durationLabel} />
          )}
        </CardContent>
      </Card>

      {tasks && tasks.length > 0 && (
        <Card variant="flush">
          <CardHeader>
            <CardTitle>Tareas</CardTitle>
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
                completedAt:
                  task.status === 'done'
                    ? (task.statusChangedAt ?? undefined)
                    : undefined,
              }))}
              readOnly
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tu observación</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-text-2">
            {assignment.notes ?? 'No cargaste ninguna observación.'}
          </p>
        </CardContent>
      </Card>

      <Button size="mobile" asChild className="mt-auto">
        <Link to="/app">Volver a Hoy</Link>
      </Button>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-text-3">{label}</span>
      <span className="text-[13px] font-semibold text-text">{value}</span>
    </div>
  )
}
