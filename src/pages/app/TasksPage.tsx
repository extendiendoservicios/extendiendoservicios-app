import { useState } from 'react'
import { useParams } from 'react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { TaskList } from '@/components/TaskList'
import { isApiError } from '@/api/errors'
import {
  canEditTasks,
  taskWindowNotice,
} from '@/features/employee/attendanceWindow'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import {
  useMyDayQuery,
  useShiftTasksQuery,
  useUpdateTaskStatusMutation,
} from '@/features/employee/queries'

/**
 * EMP-08 · Tareas (MOB-EMP-009, `05` fila EMP-08, `06` sección 9:
 * `update_task_status`): guardado inmediato por ítem, motivo obligatorio
 * para "no realizada" (lo pide `TaskItem`/`ConfirmDialog`, DS-012) y
 * bloqueo fuera de la ventana propia (P-063: solo entre el inicio y el fin
 * registrados) -- acá en solo lectura con un aviso, y si de todas formas la
 * RPC devuelve `TASK_LOCKED` (por ejemplo, alguien registró el fin en otra
 * pestaña mientras esta seguía abierta), el error de la mutación se muestra
 * igual que cualquier otro.
 */
export default function TasksPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const online = useOnlineStatus()
  const { data: myDay, isLoading } = useMyDayQuery()
  const assignment = myDay?.find((a) => a.assignmentId === assignmentId)
  const { data: tasks } = useShiftTasksQuery(assignment?.shiftId ?? '')
  const updateStatus = useUpdateTaskStatusMutation(assignment?.shiftId ?? '')
  const [error, setError] = useState<string | null>(null)

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

  const withinWindow = canEditTasks(assignment)
  const editable = withinWindow && online

  async function handleChange(
    taskId: string,
    status: 'done' | 'not_done' | 'pending',
    reason?: string,
  ) {
    setError(null)
    try {
      await updateStatus.mutateAsync({ taskId, status, reason })
    } catch (mutationError) {
      setError(
        isApiError(mutationError)
          ? mutationError.message
          : 'No pudimos guardar la tarea. Probá de nuevo.',
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!online && (
        <Alert variant="warn">
          <AlertDescription>
            Estás sin conexión: no podés marcar tareas hasta que vuelvas a tener
            señal.
          </AlertDescription>
        </Alert>
      )}
      {online && !withinWindow && (
        <Alert variant="info">
          <AlertDescription>{taskWindowNotice(assignment)}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="crit">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!tasks || tasks.length === 0 ? (
        <p className="p-4 text-center text-[12.5px] text-text-3">
          Este servicio no tiene tareas cargadas.
        </p>
      ) : (
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
          readOnly={!editable}
          onComplete={(id) => void handleChange(id, 'done')}
          onMarkNotDone={(id, reason) =>
            void handleChange(id, 'not_done', reason)
          }
          onUndo={(id) => void handleChange(id, 'pending')}
        />
      )}
    </div>
  )
}
