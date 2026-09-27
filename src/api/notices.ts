import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { fromPostgrestError } from './errors'
import type { AbsenceReason } from '@/lib/absenceReasons'

/**
 * `src/api/notices.ts` (ABS-004, `06_API.md` sección 11, migración
 * `0027_rpc_notices_admin_attendance.sql`): `notify_delay` y
 * `notify_absence`. Mismo patrón que `src/api/attendance.ts`: las dos RPC ya
 * devuelven `hint` en mayúsculas y `message` en voseo armado del lado del
 * servidor, así que `fromPostgrestError` alcanza sin un `mapWriteError`
 * propio — la pantalla solo tiene que mostrar `error.message` y, si necesita
 * lógica especial (por ejemplo, ofrecer "avisar ausencia" después de un
 * `TOO_LATE_TO_NOTIFY` en la demora), mirar `error.hint`.
 *
 * Interfaz pública que consume `front-admin` (P14.3, ADM-10/ADM-11) además
 * de `front-movil` (EMP-12): `notifyDelay`, `notifyAbsence`,
 * `AttendanceNotice`, `NoticeKind`, `NoticeErrorHint` y el tipo/las
 * etiquetas de `src/lib/absenceReasons.ts`. No se cambian firmas: si hace
 * falta otra función sobre este mismo dominio, se agrega, no se reemplaza
 * esta.
 */

export type NoticeKind = Database['public']['Enums']['notice_kind']

/** Un aviso de demora o ausencia ya guardado (`attendance_notices`, `06` sección 11). */
export interface AttendanceNotice {
  id: string
  assignmentId: string
  kind: NoticeKind
  /** Minutos estimados de demora (solo si `kind === 'delay'`). */
  minutesLate: number | null
  /** Motivo de la lista (solo si `kind === 'absence'`). */
  reasonCode: AbsenceReason | null
  /** Texto libre: opcional en demora, obligatorio en ausencia si el motivo es "otro". */
  reasonText: string | null
  /** Quién lo cargó (el propio empleado, o quien lo hizo en su nombre — dueño/administrador). */
  reportedBy: string
  /** `employee_app` si lo avisó el propio empleado; `admin` si lo cargó la administración en su nombre. */
  source: Database['public']['Enums']['attendance_source']
  createdAt: string
}

interface AttendanceNoticeRow {
  id: string
  assignment_id: string
  kind: NoticeKind
  minutes_late: number | null
  reason_code: AbsenceReason | null
  reason_text: string | null
  reported_by: string
  source: Database['public']['Enums']['attendance_source']
  created_at: string
}

function mapNotice(row: AttendanceNoticeRow): AttendanceNotice {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    kind: row.kind,
    minutesLate: row.minutes_late,
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    reportedBy: row.reported_by,
    source: row.source,
    createdAt: row.created_at,
  }
}

/**
 * Códigos propios de esta sección (`06` sección 11 y 15), documentados acá
 * para quien construye la pantalla — no reemplazan a `ApiError.hint` (que
 * sigue siendo un `string`), son una guía de los valores posibles.
 */
export type NoticeErrorHint =
  | 'ASSIGNMENT_NOT_FOUND'
  | 'NOT_YOUR_ASSIGNMENT'
  | 'FORBIDDEN'
  | 'SHIFT_CANCELLED'
  | 'SHIFT_COMPLETED'
  | 'ASSIGNMENT_STARTED'
  | 'TOO_LATE_TO_NOTIFY'
  | 'MINUTES_REQUIRED'
  | 'REASON_REQUIRED'

/**
 * Avisa una demora (`06` sección 11: `notify_delay`). Solo antes de la hora
 * de inicio efectiva de la asignación, para todos los llamadores (P-072,
 * sin excepción para el aviso en nombre) — si no, la RPC devuelve
 * `TOO_LATE_TO_NOTIFY`. `minutes`: entero de 1 a 600, obligatorio
 * (`MINUTES_REQUIRED` si falta o está fuera de rango). `reasonText`:
 * opcional.
 */
export async function notifyDelay(
  assignmentId: string,
  minutes: number,
  reasonText?: string,
): Promise<AttendanceNotice> {
  const { data, error } = await supabase.rpc('notify_delay', {
    p_assignment_id: assignmentId,
    p_minutes: minutes,
    p_reason_text: reasonText?.trim() || undefined,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapNotice(data as unknown as AttendanceNoticeRow)
}

/**
 * Avisa una ausencia (`06` sección 11: `notify_absence`). El propio
 * empleado solo antes del inicio efectivo; el dueño o un administrador con
 * `manage_attendance` también después, mientras la asignación no tenga
 * inicio registrado (P-073, P-074, ratificado el 26 sep 2026). `reasonCode`:
 * obligatorio, de la lista de `src/lib/absenceReasons.ts`
 * (`REASON_REQUIRED` si falta). `reasonText`: obligatorio si el motivo es
 * `other` (mismo `REASON_REQUIRED`), opcional en cualquier otro motivo. La
 * ausencia avisada NO libera el cupo: el administrador decide.
 */
export async function notifyAbsence(
  assignmentId: string,
  reasonCode: AbsenceReason,
  reasonText?: string,
): Promise<AttendanceNotice> {
  const { data, error } = await supabase.rpc('notify_absence', {
    p_assignment_id: assignmentId,
    p_reason_code: reasonCode,
    p_reason_text: reasonText?.trim() || undefined,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapNotice(data as unknown as AttendanceNoticeRow)
}
