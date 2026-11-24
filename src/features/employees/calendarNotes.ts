import {
  CALENDAR_NOTE_MAX_LENGTH,
  type CalendarNote,
} from '@/api/employeeCalendarNotes'

/**
 * Observaciones del calendario del mes (P31.3, D-08): lógica sin React.
 * Varias por día, en el orden en que se cargaron.
 */

/** Agrupa las observaciones por día (`YYYY-MM-DD`), respetando el orden de carga. */
export function groupNotesByDate(
  notes: CalendarNote[],
): Map<string, CalendarNote[]> {
  const byDate = new Map<string, CalendarNote[]>()
  const sorted = [...notes].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  )
  for (const note of sorted) {
    const list = byDate.get(note.date) ?? []
    list.push(note)
    byDate.set(note.date, list)
  }
  return byDate
}

export type NoteBodyCheck =
  { ok: true; body: string } | { ok: false; message: string }

/** Valida el texto como el servidor: sin espacios en los bordes, de 1 a 500 caracteres. */
export function checkNoteBody(raw: string): NoteBodyCheck {
  const body = raw.trim()
  if (body === '') {
    return { ok: false, message: 'Escribí la observación.' }
  }
  if (body.length > CALENDAR_NOTE_MAX_LENGTH) {
    return {
      ok: false,
      message: `La observación puede tener hasta ${CALENDAR_NOTE_MAX_LENGTH} caracteres.`,
    }
  }
  return { ok: true, body }
}
