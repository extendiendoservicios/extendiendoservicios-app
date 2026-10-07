// tests/e2e-avisos-asistencia/helpers/shiftFixture.ts — ABS-007/ATT-015/TEST-011 (P14.4)
//
// Turnos de HOY con horas relativas a "ahora" en hora de Argentina (nunca fechas u horas fijas,
// regla común de independencia -- esta suite se corre de noche y puede cruzar la medianoche):
// los fines se recortan a 23:59 y los inicios/fines nunca cruzan de día (mismo criterio que
// `tests/e2e-employee-shift/helpers/shiftFixture.ts`, copia deliberada, no un import cruzado).

import { createClient } from '@supabase/supabase-js'
import type { AdminClient } from './adminClient.ts'
import type { Database } from '../../../src/lib/database.types.ts'
import { readE2eAvisosAsistenciaEnv } from './env.ts'
import { SEED_ACCOUNTS } from '../../fixtures/seed-accounts.ts'

/** Fecha de hoy en hora de Argentina, como `YYYY-MM-DD` (formato `en-CA`, ya en ese orden). */
export function argentinaTodayISODate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())
}

/** Hora actual en Argentina, como `{ hours, minutes }` (24 h). */
function argentinaNowParts(): { hours: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const hours = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minutes = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return { hours, minutes }
}

/** Hora de Argentina + `offsetMinutes` (puede ser negativo), como `"HH:MM"`, sin cruzar de día. */
function argentinaTimeWithOffset(offsetMinutes: number): string {
  const { hours, minutes } = argentinaNowParts()
  let total = hours * 60 + minutes + offsetMinutes
  total = Math.max(0, Math.min(23 * 60 + 59, total)) // sin cruzar medianoche (00:00–23:59)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Minutos que faltan hasta la medianoche de Argentina, para que los specs que necesitan un turno
 * "que todavía no empezó" (varios minutos en el futuro, mismo día) puedan saltarse solos con un
 * motivo claro si se corren a último momento del día (regla del encargo: "documentar y saltar
 * explícitamente si no hay otra salida" -- un turno no puede cruzar de `shift_date`).
 */
export function argentinaMinutesUntilMidnight(): number {
  const { hours, minutes } = argentinaNowParts()
  return 23 * 60 + 59 - (hours * 60 + minutes)
}

/**
 * Minutos que pasaron desde las 0:00 de Argentina, para que los specs que necesitan un turno "que
 * ya empezó" (offset negativo, varios minutos en el pasado, mismo día) puedan saltarse solos si se
 * corren recién cruzada la medianoche -- sin esto, un offset negativo que supere los minutos ya
 * transcurridos se recorta a las 0:00 (mismo `Math.max(0, ...)` de `argentinaTimeWithOffset`) y dos
 * turnos con offsets distintos pueden terminar con la MISMA hora de inicio, se superponen entre sí
 * y `assign_employee` los rechaza (`ASSIGNMENT_OVERLAP`) -- hallazgo de esta suite, reproducido en
 * vivo contra `App_dev` a las 00:0x de Argentina. Simétrico a `argentinaMinutesUntilMidnight`.
 */
export function argentinaMinutesSinceMidnight(): number {
  const { hours, minutes } = argentinaNowParts()
  return hours * 60 + minutes
}

export interface TodayShift {
  shiftId: string
  shiftDate: string
  startTime: string
  endTime: string
}

/**
 * Turno puntual de hoy, insertado directo con la clave de servicio: empieza `startOffsetMin`
 * minutos desde ahora (puede ser negativo, ya arrancado) y termina `endOffsetMin` minutos desde
 * ahora -- ambos recortados a 23:59 si la suma se pasa de la medianoche (para que la corrida sea
 * válida a cualquier hora, incluso de madrugada).
 */
export async function createTodayShift(
  admin: AdminClient,
  clientId: string,
  siteId: string,
  startOffsetMin: number,
  endOffsetMin: number,
): Promise<TodayShift> {
  const shiftDate = argentinaTodayISODate()
  const startTime = argentinaTimeWithOffset(startOffsetMin)
  let endTime = argentinaTimeWithOffset(endOffsetMin)
  // `shifts_time_range_check` exige `end_time > start_time`: si los dos quedaron recortados a
  // 23:59 (corrida de madrugada, ya no queda margen hacia adelante), se fuerza el fin un minuto
  // antes del recorte para no violar el check -- caso extremo, documentado en el reporte.
  if (endTime <= startTime) {
    endTime = '23:59'
  }
  const { data, error } = await admin
    .from('shifts')
    .insert({
      client_id: clientId,
      site_id: siteId,
      shift_date: shiftDate,
      start_time: startTime,
      end_time: endTime,
      required_staff: 1,
    })
    .select('id')
    .single()
  if (error) {
    throw new Error(`No se pudo crear el turno de hoy: ${error.message}`)
  }
  return { shiftId: data.id, shiftDate, startTime, endTime }
}

/**
 * Asigna al empleado con la RPC real `assign_employee` (no un insert directo): `service_role` no
 * puede insertar en `assignments` (mismo hallazgo que documentaron las demás suites de backend
 * real). Inicia sesión como el dueño del seed solo para esta llamada y cierra esa sesión al
 * volver.
 */
export async function assignEmployeeToShift(
  shiftId: string,
  employeeId: string,
): Promise<string> {
  const env = readE2eAvisosAsistenciaEnv()
  if (!env) {
    throw new Error('assignEmployeeToShift() llamado sin .env.local completo.')
  }
  const owner = createClient<Database>(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: loginError } = await owner.auth.signInWithPassword({
    email: SEED_ACCOUNTS.owner,
    password: env.seedPassword,
  })
  if (loginError) {
    throw new Error(
      `No se pudo iniciar sesión como el dueño del seed: ${loginError.message}`,
    )
  }
  const { data, error } = await owner.rpc('assign_employee', {
    p_shift_id: shiftId,
    p_employee_id: employeeId,
  })
  await owner.auth.signOut()
  if (error) {
    throw new Error(
      `No se pudo crear la asignación de fixture: ${error.message}`,
    )
  }
  const payload = data as unknown as { assignment: { id: string } }
  return payload.assignment.id
}

export async function fetchAssignmentStatus(
  admin: AdminClient,
  assignmentId: string,
): Promise<string> {
  const { data, error } = await admin
    .from('assignments')
    .select('status')
    .eq('id', assignmentId)
    .single()
  if (error) {
    throw new Error(
      `No se pudo leer el estado de la asignación: ${error.message}`,
    )
  }
  return data.status
}

export interface AttendanceNoticeRow {
  kind: 'delay' | 'absence' | 'on_the_way'
  minutes_late: number | null
  reason_code: string | null
  reason_text: string | null
  source: 'employee_app' | 'admin'
}

/** Lee `attendance_notices` de una asignación, para verificar en la Base lo que quedó guardado. */
export async function fetchAttendanceNotices(
  admin: AdminClient,
  assignmentId: string,
): Promise<AttendanceNoticeRow[]> {
  const { data, error } = await admin
    .from('attendance_notices')
    .select('kind, minutes_late, reason_code, reason_text, source')
    .eq('assignment_id', assignmentId)
  if (error) {
    throw new Error(
      `No se pudieron leer attendance_notices de ${assignmentId}: ${error.message}`,
    )
  }
  return data ?? []
}

export interface AttendanceRecordRow {
  kind: 'check_in' | 'check_out'
  source: 'employee_app' | 'admin'
  recorded_by: string | null
  reason: string | null
}

/** Lee `attendance_records` de una asignación, para verificar quién y cómo se registró. */
export async function fetchAttendanceRecords(
  admin: AdminClient,
  assignmentId: string,
): Promise<AttendanceRecordRow[]> {
  const { data, error } = await admin
    .from('attendance_records')
    .select('kind, source, recorded_by, reason')
    .eq('assignment_id', assignmentId)
  if (error) {
    throw new Error(
      `No se pudieron leer attendance_records de ${assignmentId}: ${error.message}`,
    )
  }
  return data ?? []
}
