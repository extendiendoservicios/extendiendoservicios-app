import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { fromPostgrestError } from './errors'

/**
 * `src/api/adminNotices.ts` (ATT-010, ABS-008, `06_API.md` sección 11,
 * migración `0027_rpc_notices_admin_attendance.sql`): avisar demora o
 * ausencia EN NOMBRE del empleado, desde ADM-11.
 *
 * Archivo propio y mínimo, aislado de `src/api/notices.ts` (P14.2,
 * front-movil, en paralelo): ese módulo va a exponer `notifyDelay`/
 * `notifyAbsence` para que el propio empleado avise desde su app. Acá se
 * llama a las mismas dos RPC (`notify_delay`/`notify_absence`), pero para el
 * uso "en nombre de" del administrador (`app.is_admin()` + capacidad
 * `manage_attendance`, dentro de la RPC) -- se duplica la llamada en vez de
 * importar el módulo del otro paquete para no generar una dependencia
 * cruzada entre dos agentes que trabajan en simultáneo sobre ramas
 * distintas. El orquestador unifica los dos archivos al integrar (ver el
 * reporte del encargo).
 */

export type NoticeKind = Database['public']['Enums']['notice_kind']
export type AbsenceReason = Database['public']['Enums']['absence_reason']

/** Resultado de avisar una demora o una ausencia: lo que la pantalla puede mostrar. */
export interface AttendanceNotice {
  id: string
  assignmentId: string
  kind: NoticeKind
  minutesLate: number | null
  reasonCode: AbsenceReason | null
  reasonText: string | null
  createdAt: string
}

function mapNotice(row: {
  id: string
  assignment_id: string
  kind: NoticeKind
  minutes_late: number | null
  reason_code: AbsenceReason | null
  reason_text: string | null
  created_at: string
}): AttendanceNotice {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    kind: row.kind,
    minutesLate: row.minutes_late,
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    createdAt: row.created_at,
  }
}

/**
 * Avisa una demora en nombre del empleado (ADM-11; `06` sección 11:
 * `notify_delay`; P-072, P-074). Solo antes del inicio efectivo, sin
 * excepción (ratificado el 26 sep 2026, P14.0). `minutes`: 1 a 600.
 */
export async function notifyDelayOnBehalf(
  assignmentId: string,
  minutes: number,
  reasonText?: string,
): Promise<AttendanceNotice> {
  const { data, error } = await supabase.rpc('notify_delay', {
    p_assignment_id: assignmentId,
    p_minutes: minutes,
    p_reason_text: reasonText,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapNotice(data)
}

/**
 * Avisa una ausencia en nombre del empleado (ADM-11, ABS-008; `06`
 * sección 11: `notify_absence`; P-073, P-074). El dueño y el administrador
 * con `manage_attendance` pueden avisarla antes o después del inicio
 * efectivo, mientras la asignación no tenga inicio registrado (ratificado
 * el 26 sep 2026, P14.0) -- a diferencia del propio empleado, que solo
 * puede antes. Motivo obligatorio; si es `other`, también el texto.
 */
export async function notifyAbsenceOnBehalf(
  assignmentId: string,
  reasonCode: AbsenceReason,
  reasonText?: string,
): Promise<AttendanceNotice> {
  const { data, error } = await supabase.rpc('notify_absence', {
    p_assignment_id: assignmentId,
    p_reason_code: reasonCode,
    p_reason_text: reasonText,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapNotice(data)
}
