import { supabase } from '@/lib/supabase'
import { fromPostgrestError } from './errors'

/**
 * `src/api/employeeCalendarNotes.ts` (P31.3, D-08): observaciones del
 * calendario del mes de un empleado (0088). Una celda de texto en un día, con
 * color opcional (0–11, la misma paleta de los clientes). Solo dueño y
 * administradores. Varias por día. El borrado es lógico.
 *
 * Códigos de error (`hint`): `FORBIDDEN`, `EMPLOYEE_NOT_FOUND`, `INVALID_DATE`,
 * `INVALID_NOTE_BODY` (vacía o de más de 500), `INVALID_COLOR`,
 * `NOTE_NOT_FOUND`, `INVALID_DATE_RANGE`.
 */

/** Tope del texto de una observación (el servidor también lo exige). */
export const CALENDAR_NOTE_MAX_LENGTH = 500

export interface CalendarNote {
  id: string
  employeeId: string
  /** `YYYY-MM-DD`. */
  date: string
  body: string
  /** Índice 0–11 del color, o `null` si no tiene. */
  color: number | null
  createdAt: string
  createdByName: string | null
  updatedAt: string
  updatedByName: string | null
}

/** Observaciones de la persona entre dos fechas (hasta 400 días), por día y orden de carga. */
export async function fetchEmployeeCalendarNotes(
  employeeId: string,
  from: string,
  to: string,
): Promise<CalendarNote[]> {
  const { data, error } = await supabase.rpc('list_employee_calendar_notes', {
    p_employee_id: employeeId,
    p_from: from,
    p_to: to,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    date: row.note_date,
    body: row.body,
    color: row.color ?? null,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name ?? null,
  }))
}

export interface SaveCalendarNoteInput {
  /** `null` = alta; con id = cambio de texto, color o día. */
  noteId: string | null
  employeeId: string
  date: string
  body: string
  color: number | null
}

/** Alta o cambio de una observación. */
export async function saveEmployeeCalendarNote(
  input: SaveCalendarNoteInput,
): Promise<void> {
  const { error } = await supabase.rpc('save_employee_calendar_note', {
    // Los tipos generados piden un texto: el servidor acepta `null` para el alta.
    p_note_id: input.noteId as string,
    p_employee_id: input.employeeId,
    p_date: input.date,
    p_body: input.body,
    ...(input.color != null ? { p_color: input.color } : {}),
  })
  if (error) {
    throw fromPostgrestError(error)
  }
}

/** Da de baja una observación (borrado lógico). */
export async function deleteEmployeeCalendarNote(
  noteId: string,
): Promise<void> {
  const { error } = await supabase.rpc('delete_employee_calendar_note', {
    p_note_id: noteId,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
}
