import { useState } from 'react'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { StatusBadge } from '@/components/status'
import { isApiError } from '@/api/errors'
import { TASK_STATUS_LABELS, type TaskStatus } from '@/api/tasks'
import type { ShiftDetailTask } from '@/api/assignments'
import { useUpdateTaskStatusMutation } from '@/features/planning/queries'

const TASK_STATUS_ORDER: TaskStatus[] = [
  'pending',
  'in_progress',
  'done',
  'not_done',
]

/**
 * Lista de tareas del turno con cambio de estado por el administrador
 * (TASK-006, `05` línea 40: "Tareas (estado de cada una)", `04` sección
 * 6.3: pendiente/en curso/realizada/no realizada, sin restricción de
 * transición). `not_done` pide motivo obligatorio (`ConfirmDialog`, mismo
 * componente que `RemoveAssignmentDialog`); las otras tres se aplican
 * directo desde el `Select`.
 *
 * `canManage` en `false` (sin rol O/A, `canManageTasks`): lista de solo
 * lectura con `StatusBadge`, igual que antes de este paquete.
 */
interface AdminTaskListProps {
  tasks: ShiftDetailTask[]
  canManage: boolean
}

function AdminTaskList({ tasks, canManage }: AdminTaskListProps) {
  const updateStatus = useUpdateTaskStatusMutation()
  const [notDoneTarget, setNotDoneTarget] = useState<ShiftDetailTask | null>(
    null,
  )

  async function handleStatusChange(task: ShiftDetailTask, status: TaskStatus) {
    if (status === 'not_done') {
      setNotDoneTarget(task)
      return
    }
    try {
      await updateStatus.mutateAsync({ taskId: task.id, status })
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos cambiar el estado de la tarea.',
      )
    }
  }

  async function handleConfirmNotDone(reason: string) {
    if (!notDoneTarget) {
      return
    }
    try {
      await updateStatus.mutateAsync({
        taskId: notDoneTarget.id,
        status: 'not_done',
        reason,
      })
      setNotDoneTarget(null)
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos marcar la tarea como no realizada.',
      )
    }
  }

  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((task) => (
        <li
          key={task.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
        >
          <div className="min-w-0">
            <p className="text-[12.5px] text-text">
              {task.title}
              {!task.isRequired && (
                <span className="text-text-3"> · opcional</span>
              )}
            </p>
            {task.description && (
              <p className="text-[11px] text-text-3">{task.description}</p>
            )}
            {task.status === 'not_done' && task.notDoneReason && (
              <p className="text-[11px] text-danger-800">
                Motivo: {task.notDoneReason}
              </p>
            )}
          </div>
          {canManage ? (
            <Select
              value={task.status}
              onValueChange={(value) =>
                void handleStatusChange(task, value as TaskStatus)
              }
            >
              <SelectTrigger
                aria-label={`Estado de "${task.title}"`}
                className="w-[150px] shrink-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_STATUS_ORDER.map((status) => (
                  <SelectItem key={status} value={status}>
                    {TASK_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <StatusBadge domain="task" status={task.status} />
          )}
        </li>
      ))}

      <ConfirmDialog
        open={notDoneTarget != null}
        onOpenChange={(open) => !open && setNotDoneTarget(null)}
        title={`Marcar "${notDoneTarget?.title ?? ''}" como no realizada`}
        reasonLabel="Motivo"
        reasonPlaceholder="Contá por qué no se pudo hacer…"
        confirmLabel="Marcar no realizada"
        variant="destructive"
        isLoading={updateStatus.isPending}
        onConfirm={(reason) => void handleConfirmNotDone(reason)}
      />
    </ul>
  )
}

export { AdminTaskList }
