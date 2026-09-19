import { cn } from 'cn'
import { TaskItem } from '@/components/TaskItem'
import type { DateInput } from '@/lib/format'
import type { TaskStatus } from '@/components/status'

/**
 * TaskList (DS-012): lista de `TaskItem` (`07` sección 2.4). Calcula sola
 * cuál es la tarea "next" (resaltada, `.task.next` de ds2.css): la que está
 * `in_progress`, o si ninguna lo está, la primera `pending` en el orden de
 * la lista — así siempre hay como mucho una tarea destacada como "la que
 * sigue" (decisión menor, ver reporte).
 */
interface TaskListTask {
  id: string
  title: string
  description?: string
  status: TaskStatus
  isRequired?: boolean
  notDoneReason?: string
  completedAt?: DateInput
}

interface TaskListProps {
  tasks: TaskListTask[]
  readOnly?: boolean
  onComplete?: (id: string) => void
  onMarkNotDone?: (id: string, reason: string) => void
  onUndo?: (id: string) => void
  className?: string
}

function getNextTaskId(tasks: TaskListTask[]): string | undefined {
  const inProgress = tasks.find((task) => task.status === 'in_progress')
  if (inProgress) {
    return inProgress.id
  }
  return tasks.find((task) => task.status === 'pending')?.id
}

function TaskList({
  tasks,
  readOnly = false,
  onComplete,
  onMarkNotDone,
  onUndo,
  className,
}: TaskListProps) {
  const nextTaskId = getNextTaskId(tasks)

  return (
    <div className={cn('flex flex-col divide-y divide-border', className)}>
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          id={task.id}
          title={task.title}
          description={task.description}
          status={task.status}
          isRequired={task.isRequired}
          notDoneReason={task.notDoneReason}
          completedAt={task.completedAt}
          isNext={task.id === nextTaskId}
          readOnly={readOnly}
          onComplete={onComplete}
          onMarkNotDone={onMarkNotDone}
          onUndo={onUndo}
        />
      ))}
    </div>
  )
}

export { TaskList }
export type { TaskListProps, TaskListTask }
