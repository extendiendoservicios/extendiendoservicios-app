import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { fromPostgrestError } from './errors'

/**
 * `src/api/tasks.ts` (TASK-003, `06_API.md` sección 9): la tarea YA COPIADA
 * a un turno (`shift_tasks`), a diferencia de `src/api/checklists.ts`
 * (plantillas). Una sola RPC nueva acá: `update_task_status`
 * (`0025_rpc_tasks.sql`).
 *
 * `reload_shift_tasks` ya existía en `src/api/shifts.ts` desde SHIFT-007
 * (F10, `06` sección 7 la agrupa con las otras RPC de turnos) -- se
 * reexporta acá para que ADM-06 tenga un solo punto de importación para
 * todo lo de tareas, sin duplicar la función (mismo criterio que
 * `mapShiftBoardRow`/`SHIFT_BOARD_SELECT` reexportados desde
 * `src/api/assignments.ts`).
 */
export { reloadShiftTasks } from './shifts'

export type TaskStatus = Database['public']['Enums']['task_status']

/** Las cuatro etiquetas de `04_Modelo_de_Datos.md` sección 6.3 (P-060). */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En curso',
  done: 'Realizada',
  not_done: 'No realizada',
}

export interface ShiftTask {
  id: string
  shiftId: string
  position: number
  title: string
  description: string | null
  isRequired: boolean
  status: TaskStatus
  notDoneReason: string | null
}

function mapTaskRow(
  row: Database['public']['Tables']['shift_tasks']['Row'],
): ShiftTask {
  return {
    id: row.id,
    shiftId: row.shift_id,
    position: row.position,
    title: row.title,
    description: row.description,
    isRequired: row.is_required,
    status: row.status,
    notDoneReason: row.not_done_reason,
  }
}

/**
 * Tareas previstas de un turno, en lectura (EMP-04, `06` sección 9: "Tareas
 * de un turno | from('shift_tasks').eq('shift_id').order('position') | O,
 * A, S, E (sus turnos)"). Se agrega acá en vez de en `src/api/myDay.ts`
 * porque el mapeo de una fila de `shift_tasks` ya vive en este módulo
 * (`mapTaskRow`) — reusarlo evita mantener dos veces la misma forma.
 */
export async function fetchShiftTasksReadOnly(
  shiftId: string,
): Promise<ShiftTask[]> {
  const { data, error } = await supabase
    .from('shift_tasks')
    .select('*')
    .eq('shift_id', shiftId)
    .order('position', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map(mapTaskRow)
}

/**
 * Cambia el estado de una tarea del turno (`06` sección 9:
 * `update_task_status`, `04` sección 6.3). `reason` obligatorio si
 * `status` es `not_done` (si no, `REASON_REQUIRED`); el administrador
 * puede hacerlo en cualquier momento del turno (P-063), el empleado solo
 * con su asignación vigente `present` (`TASK_LOCKED` si no).
 */
export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  reason?: string,
): Promise<ShiftTask> {
  const { data, error } = await supabase.rpc('update_task_status', {
    p_task_id: taskId,
    p_status: status,
    p_reason: reason,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapTaskRow(data)
}
