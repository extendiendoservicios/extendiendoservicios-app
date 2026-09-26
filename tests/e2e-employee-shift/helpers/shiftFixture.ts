// tests/e2e-employee-shift/helpers/shiftFixture.ts — MOB-EMP-017/TEST-010 (P13.4)
//
// Turno de HOY (P-068: el inicio puede registrarse en cualquier momento del día del turno, hora
// de Argentina) con tareas y una asignación real, para el turno completo de punta a punta. Fechas
// y horas siempre relativas a "hoy" en hora de Argentina (regla común de independencia; ADR-019:
// offset fijo `-03:00`, sin horario de verano), nunca fechas fijas.

import { createClient } from '@supabase/supabase-js'
import type { AdminClient } from './adminClient.ts'
import type { Database } from '../../../src/lib/database.types.ts'
import { readE2eEmployeeShiftEnv } from './env.ts'
import { SEED_ACCOUNTS } from '../../permissions/fixtures/seed-accounts.ts'

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

/** Fecha de hoy + `days` en hora de Argentina (P-093: "próximos 7 días" de `v_my_day`). */
export function argentinaDateOffset(days: number): string {
  const base = new Date(`${argentinaTodayISODate()}T12:00:00-03:00`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

export interface TodayShift {
  shiftId: string
  shiftDate: string
  startTime: string
  endTime: string
}

/** Turno puntual en una fecha explícita (para "próximos días", `v_my_day`/P-093). */
export async function createShiftOnDate(
  admin: AdminClient,
  clientId: string,
  siteId: string,
  shiftDate: string,
  startTime: string,
  endTime: string,
): Promise<TodayShift> {
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
    throw new Error(`No se pudo crear el turno de fixture: ${error.message}`)
  }
  return { shiftId: data.id, shiftDate, startTime, endTime }
}

/**
 * Turno puntual de hoy, insertado directo con la clave de servicio (igual que
 * `tests/permissions/helpers/assignment-fixtures.ts`): empieza `startOffsetMin` minutos antes de
 * ahora (por defecto 10, ya arrancado — así el inicio se puede registrar de entrada, P-068) y
 * termina `endOffsetMin` minutos después de ahora (por defecto 120 — bien entrada la salida
 * anticipada de EMP-10, P-076).
 */
export async function createTodayShift(
  admin: AdminClient,
  clientId: string,
  siteId: string,
  startOffsetMin = -10,
  endOffsetMin = 120,
): Promise<TodayShift> {
  const shiftDate = argentinaTodayISODate()
  const startTime = argentinaTimeWithOffset(startOffsetMin)
  const endTime = argentinaTimeWithOffset(endOffsetMin)
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

/** Tarea del turno, insertada directo (mismo criterio que `tests/permissions/helpers/checklist-fixtures.ts`). */
export async function createTodayShiftTask(
  admin: AdminClient,
  shiftId: string,
  position: number,
  title: string,
  isRequired: boolean,
): Promise<string> {
  const { data, error } = await admin
    .from('shift_tasks')
    .insert({
      shift_id: shiftId,
      position,
      title,
      is_required: isRequired,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error) {
    throw new Error(`No se pudo crear la tarea de fixture: ${error.message}`)
  }
  return data.id
}

/**
 * Asigna al empleado con la RPC real `assign_employee` (no un insert directo): `service_role` no
 * puede insertar en `assignments` (el trigger `app.sync_assignment_window` exige `usage on schema
 * app`, que `service_role` no tiene — mismo hallazgo que documentó
 * `tests/permissions/helpers/assignment-fixtures.ts` para TEST-008). Inicia sesión como el dueño
 * del seed solo para esta llamada (nunca con la clave de servicio) y cierra esa sesión al volver,
 * para no dejarla abierta durante el resto del test.
 */
export async function assignEmployeeToShift(
  shiftId: string,
  employeeId: string,
): Promise<string> {
  const env = readE2eEmployeeShiftEnv()
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

export interface AttendanceRecordRow {
  kind: 'check_in' | 'check_out'
  latitude: number | null
  longitude: number | null
  accuracy_m: number | null
}

/** Lee `attendance_records` de una asignación (columna de servicio, solo para verificar en la Base — nunca se muestran en ninguna pantalla, ADR-009). */
export async function fetchAttendanceRecords(
  admin: AdminClient,
  assignmentId: string,
): Promise<AttendanceRecordRow[]> {
  const { data, error } = await admin
    .from('attendance_records')
    .select('kind, latitude, longitude, accuracy_m')
    .eq('assignment_id', assignmentId)
  if (error) {
    throw new Error(
      `No se pudieron leer attendance_records de ${assignmentId}: ${error.message}`,
    )
  }
  return data ?? []
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

export async function fetchShiftStatus(
  admin: AdminClient,
  shiftId: string,
): Promise<string> {
  const { data, error } = await admin
    .from('shifts')
    .select('status')
    .eq('id', shiftId)
    .single()
  if (error) {
    throw new Error(`No se pudo leer el estado del turno: ${error.message}`)
  }
  return data.status
}
