// tests/e2e-supervisiones/helpers/shiftFixture.ts — SUP-013/MOB-SUP-013/TEST-013 (P15.6,
// 08_Fases_y_Backlog.md F15)
//
// Turnos y supervisiones de fixture para esta suite. Dos anclas de fecha, según qué pantalla se
// prueba:
// - "Hoy" en hora de Argentina (`argentinaTodayISODate`/`argentinaTimeWithOffset`, copia
//   deliberada de `tests/e2e-employee-shift/helpers/shiftFixture.ts`): hace falta para SUP-02
//   ("Hoy"), que solo lista las supervisiones de HOY -- no hay forma de probar esa pantalla con
//   una fecha futura. Las cuentas de esta suite son descartables y propias (`peopleFixture.ts`),
//   así que depender de "hoy" acá no tiene la fragilidad que señaló el reporte de pausa de P15.6
//   para `tests/permissions/` (esas pruebas usan cuentas FIJAS del seed, compartidas con el resto
//   de la operación de `App_dev`; estas son de un solo uso).
// - "Mañana" a horas fijas (`tomorrowISODate` + horas de reloj, sin offset contra "ahora"): para
//   el escritorio de administración (SUP-013), que no necesita que el turno sea de hoy -- mañana
//   evita cualquier choque con turnos reales del seed y no depende de la hora a la que corra la
//   suite (regla del encargo: "ninguna fixture puede depender de la hora del reloj").

import { createClient } from '@supabase/supabase-js'
import type { AdminClient } from './adminClient.ts'
import type { Database } from '../../../src/lib/database.types.ts'
import { readE2eSupervisionesEnv } from './env.ts'
import { SEED_ACCOUNTS } from '../../permissions/fixtures/seed-accounts.ts'

/** Fecha de hoy en hora de Argentina, como `YYYY-MM-DD` (formato `en-CA`, ya en ese orden). */
export function argentinaTodayISODate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())
}

/** Fecha de mañana en hora de Argentina (ancla fija, sin depender de la hora actual). */
export function tomorrowISODate(): string {
  const base = new Date(`${argentinaTodayISODate()}T12:00:00-03:00`)
  base.setUTCDate(base.getUTCDate() + 1)
  return base.toISOString().slice(0, 10)
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

export interface FixtureShift {
  shiftId: string
  shiftDate: string
  startTime: string
  endTime: string
}

/**
 * Turno de HOY, insertado directo con la clave de servicio: empieza `startOffsetMin` minutos
 * antes de ahora (por defecto 10, ya arrancado) y termina `endOffsetMin` minutos después de ahora
 * (por defecto 120).
 */
export async function createTodayShift(
  admin: AdminClient,
  clientId: string,
  siteId: string,
  startOffsetMin = -10,
  endOffsetMin = 120,
): Promise<FixtureShift> {
  const shiftDate = argentinaTodayISODate()
  const startTime = argentinaTimeWithOffset(startOffsetMin)
  const endTime = argentinaTimeWithOffset(endOffsetMin)
  return insertShift(admin, clientId, siteId, shiftDate, startTime, endTime)
}

/** Turno de MAÑANA a horas fijas de reloj (sin relación con "ahora"). */
export async function createTomorrowShift(
  admin: AdminClient,
  clientId: string,
  siteId: string,
  startTime: string,
  endTime: string,
): Promise<FixtureShift> {
  return insertShift(
    admin,
    clientId,
    siteId,
    tomorrowISODate(),
    startTime,
    endTime,
  )
}

async function insertShift(
  admin: AdminClient,
  clientId: string,
  siteId: string,
  shiftDate: string,
  startTime: string,
  endTime: string,
): Promise<FixtureShift> {
  const { data, error } = await admin
    .from('shifts')
    .insert({
      client_id: clientId,
      site_id: siteId,
      shift_date: shiftDate,
      start_time: startTime,
      end_time: endTime,
      // 3, no 2: `mobile-supervisor-flow.spec.ts` asigna hasta tres personas al mismo turno
      // (el propio supervisor como empleado, CB-13, más dos empleados a calificar).
      required_staff: 3,
    })
    .select('id')
    .single()
  if (error) {
    throw new Error(`No se pudo crear el turno de fixture: ${error.message}`)
  }
  return { shiftId: data.id, shiftDate, startTime, endTime }
}

/** Cliente logueado como el dueño del seed, para llamar RPC que `service_role` no puede (triggers del esquema `app`). */
async function ownerClient() {
  const env = readE2eSupervisionesEnv()
  if (!env) {
    throw new Error('ownerClient() llamado sin .env.local completo.')
  }
  const owner = createClient<Database>(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await owner.auth.signInWithPassword({
    email: SEED_ACCOUNTS.owner,
    password: env.seedPassword,
  })
  if (error) {
    throw new Error(
      `No se pudo iniciar sesión como el dueño del seed: ${error.message}`,
    )
  }
  return owner
}

/**
 * Asigna a un empleado con la RPC real `assign_employee` (no un insert directo: `service_role`
 * no tiene `usage` sobre el esquema `app` que necesita el trigger `sync_assignment_window`,
 * mismo hallazgo que `tests/permissions/helpers/assignment-fixtures.ts`). Logueado como el dueño
 * del seed solo para esta llamada.
 */
export async function assignEmployeeToShift(
  shiftId: string,
  employeeId: string,
): Promise<string> {
  const owner = await ownerClient()
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

/** Asigna una supervisión con la RPC real `assign_supervision`, logueado como el dueño del seed. */
export async function assignSupervisionToShift(
  shiftId: string,
  supervisorId: string,
): Promise<string> {
  const owner = await ownerClient()
  const { data, error } = await owner.rpc('assign_supervision', {
    p_shift_id: shiftId,
    p_supervisor_id: supervisorId,
  })
  await owner.auth.signOut()
  if (error) {
    throw new Error(
      `No se pudo crear la supervisión de fixture: ${error.message}`,
    )
  }
  const payload = data as unknown as { supervision: { id: string } }
  return payload.supervision.id
}

/** Cancela una supervisión de fixture (limpieza), logueado como el dueño del seed. Silencioso si ya está en un estado terminal. */
export async function cancelSupervisionFixture(
  supervisionId: string,
): Promise<void> {
  const owner = await ownerClient()
  await owner.rpc('cancel_supervision', {
    p_supervision_id: supervisionId,
    p_reason: 'E2E-P156: limpieza de la supervisión de fixture',
  })
  await owner.auth.signOut()
}

/** Fuerza el estado de una supervisión a mano (clave de servicio): para preparar un escenario de "editar calificación" sin tener que fichar de verdad como el supervisor, mismo criterio que `tests/permissions/admin.permissions.ts`. */
export async function forceSupervisionStatus(
  admin: AdminClient,
  supervisionId: string,
  status: 'assigned' | 'in_progress' | 'completed' | 'not_done' | 'cancelled',
): Promise<void> {
  const { error } = await admin
    .from('supervisions')
    .update({ status })
    .eq('id', supervisionId)
  if (error) {
    throw new Error(
      `No se pudo forzar la supervisión ${supervisionId} a ${status}: ${error.message}`,
    )
  }
}

export async function fetchSupervisionStatus(
  admin: AdminClient,
  supervisionId: string,
): Promise<string> {
  const { data, error } = await admin
    .from('supervisions')
    .select('status')
    .eq('id', supervisionId)
    .single()
  if (error) {
    throw new Error(
      `No se pudo leer el estado de la supervisión: ${error.message}`,
    )
  }
  return data.status
}

export interface SupervisionAttendanceRow {
  kind: 'check_in' | 'check_out'
  latitude: number | null
  longitude: number | null
  accuracy_m: number | null
}

/** Lee `supervision_attendance` de una supervisión (columna de servicio, solo para verificar en la Base -- nunca se muestran en ninguna pantalla, ADR-009). */
export async function fetchSupervisionAttendance(
  admin: AdminClient,
  supervisionId: string,
): Promise<SupervisionAttendanceRow[]> {
  const { data, error } = await admin
    .from('supervision_attendance')
    .select('kind, latitude, longitude, accuracy_m')
    .eq('supervision_id', supervisionId)
  if (error) {
    throw new Error(
      `No se pudo leer supervision_attendance de ${supervisionId}: ${error.message}`,
    )
  }
  return data ?? []
}
