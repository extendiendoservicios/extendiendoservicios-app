import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { fromPostgrestError } from './errors'
import type { GeolocationCoords } from '@/lib/geolocation'

/**
 * `src/api/attendance.ts` (ATT-005, `06_API.md` sección 10, migración
 * `0026_rpc_attendance.sql`): `record_check_in`, `record_check_out` y
 * `set_assignment_notes`. Este paquete (P13.2) no llama todavía a
 * `recordCheckIn`/`recordCheckOut` desde ninguna pantalla propia (EMP-05 y
 * EMP-07 son de P13.3) — quedan completas, tipadas y con tests para que ese
 * encargo las use tal cual, sin tener que tocar este archivo.
 *
 * Igual que `assignments.ts`/`tasks.ts`: las tres RPC ya devuelven `hint` en
 * mayúsculas y `message` en voseo armado del lado del servidor (`06`
 * sección 15: `NOT_TODAY`, `ALREADY_CHECKED_IN`, `NOT_CHECKED_IN`,
 * `ALREADY_CHECKED_OUT`, `COORDINATES_INCOMPLETE`,
 * `COORDINATES_OUT_OF_RANGE`, `NOTES_TOO_LONG`, `SHIFT_COMPLETED`,
 * `FORBIDDEN`, etc.), así que `fromPostgrestError` alcanza sin un
 * `mapWriteError` propio: la pantalla solo tiene que mostrar `error.message`
 * y, si necesita lógica especial (por ejemplo deshabilitar el botón),
 * mirar `error.hint`.
 *
 * IMPORTANTE (ADR-009, P-067): las coordenadas que devuelve el servidor
 * (latitud, longitud, precisión) NO se mapean a ningún tipo de este
 * archivo — a propósito, para que sea imposible mostrarlas por accidente en
 * una pantalla ("no se muestran en ninguna pantalla de la Base"). Si algún
 * día un módulo extra las necesita, se agrega ahí, no acá.
 */

export type AttendanceKind = Database['public']['Enums']['attendance_kind']

/** Resultado de fichar el inicio o el fin: solo lo que la pantalla puede mostrar (ADR-009). */
export interface AttendanceRecord {
  id: string
  assignmentId: string
  kind: AttendanceKind
  /** Hora del servidor (`now()` dentro de la RPC, nunca la del dispositivo — ADR-009). */
  recordedAt: string
}

function mapAttendanceRecord(row: {
  id: string
  assignment_id: string
  kind: AttendanceKind
  recorded_at: string
}): AttendanceRecord {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    kind: row.kind,
    recordedAt: row.recorded_at,
  }
}

/**
 * Registra el inicio del servicio (`06` sección 10: `record_check_in`).
 * `coords`: `null` si el empleado no dio su consentimiento, negó el permiso
 * del navegador o la posición no llegó a tiempo (`getCurrentPositionSafe`,
 * `src/lib/geolocation.ts`) — en ese caso se manda sin latitud, longitud ni
 * precisión, y el registro se hace igual (P-067, P-091, `COORDINATES_INCOMPLETE`
 * solo salta si se manda ALGUNA de las tres sin las otras dos, nunca por
 * mandar ninguna).
 */
export async function recordCheckIn(
  assignmentId: string,
  coords: GeolocationCoords | null,
): Promise<AttendanceRecord> {
  const { data, error } = await supabase.rpc('record_check_in', {
    p_assignment_id: assignmentId,
    p_lat: coords?.lat,
    p_lng: coords?.lng,
    p_accuracy: coords?.accuracyM,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapAttendanceRecord(data)
}

/** Registra el fin del servicio (`06` sección 10: `record_check_out`). Mismo criterio de ubicación que `recordCheckIn`. */
export async function recordCheckOut(
  assignmentId: string,
  coords: GeolocationCoords | null,
): Promise<AttendanceRecord> {
  const { data, error } = await supabase.rpc('record_check_out', {
    p_assignment_id: assignmentId,
    p_lat: coords?.lat,
    p_lng: coords?.lng,
    p_accuracy: coords?.accuracyM,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapAttendanceRecord(data)
}

/** La asignación después de guardar la observación (`06` sección 8: `set_assignment_notes`). */
export interface AssignmentNotesResult {
  id: string
  notes: string | null
}

/**
 * Guarda la observación del servicio (P-062, una por asignación). Texto
 * vacío o solo espacios se guarda como `null` del lado del servidor; más de
 * 2000 caracteres → `NOTES_TOO_LONG`. El empleado solo puede sobre su
 * propia asignación y mientras el turno no esté `completed`
 * (`SHIFT_COMPLETED`); sobre una ajena, `FORBIDDEN`.
 */
export async function setAssignmentNotes(
  assignmentId: string,
  notes: string,
): Promise<AssignmentNotesResult> {
  const { data, error } = await supabase.rpc('set_assignment_notes', {
    p_assignment_id: assignmentId,
    p_notes: notes,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return { id: data.id, notes: data.notes }
}
