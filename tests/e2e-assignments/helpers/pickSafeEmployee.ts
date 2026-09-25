// tests/e2e-assignments/helpers/pickSafeEmployee.ts — ASSIGN-015 (P11.4)
//
// Elige, de las diez cuentas de empleado del seed, la primera SIN conflicto real para una fecha
// y franja dadas (sin licencia vigente ese día, sin ninguna asignación que SE SUPERPONGA con esa
// franja): los specs de esta suite que no están probando conflictos a propósito (solo quieren
// que la asignación se cree sin sorpresas) no pueden asumir que un nombre fijo ("Carlos Medina",
// "Lucía Torres") esté siempre libre -- el seed de `App_dev` tiene licencias y asignaciones
// reales que cambian con el tiempo, y el criterio de F11 exige que la suite sea estable, no que
// dependa de memorizar el estado actual de cada persona (encontrado armando esta suite, ver el
// reporte del encargo P11.4).
//
// Corrección del qa-pruebas que retoma el encargo: la primera versión descartaba a un empleado
// por tener CUALQUIER asignación ESE DÍA, sin mirar la hora -- demasiado estricto. El seed real
// reparte turnos entre los diez empleados casi todos los días hábiles (uno cada uno, en horarios
// distintos), así que en un día de semana los diez quedaban "ocupados" aunque ninguno se
// superpusiera con la franja del fixture, y la función fallaba con "ningún empleado libre"
// (reproducido en vivo: los diez empleados tenían exactamente una asignación real el lunes
// 2026-09-28, y sin embargo la franja 09:00-13:00 del fixture no se superponía con ninguna).
// Ahora compara la franja real (en UTC, `app.local_ts`, ADR-019 -- Argentina no tiene horario de
// verano, el desfasaje es siempre -03:00) contra la ventana de cada asignación existente, el
// mismo criterio que usa la RPC `assign_employee` para `ASSIGNMENT_OVERLAP`.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/lib/database.types.ts'
import { SEED_ACCOUNTS } from '../../permissions/fixtures/seed-accounts.ts'
import { resolveUserId } from '../../permissions/helpers/admin-lookups.ts'

export interface SafeEmployee {
  id: string
  /** Nombre completo tal como aparece en la interfaz (`PersonCell`), para filtrar el candidato. */
  fullName: string
}

export interface PickSafeEmployeeOptions {
  /** Franja LOCAL (América/Argentina/Buenos_Aires) del turno de fixture. Por defecto 08:00-12:00. */
  startTime?: string
  endTime?: string
  /** Empleados a descartar de entrada (para elegir un segundo candidato distinto del primero). */
  excludeIds?: string[]
}

// Nombres del seed, en el mismo orden que `SEED_ACCOUNTS.employees` (`fixtures/seed-accounts.ts`).
const EMPLOYEE_FULL_NAMES = [
  'María Gómez',
  'Juan Pérez',
  'Sofía Ruiz',
  'Carlos Medina',
  'Lucía Torres',
  'Rocío Aguirre',
  'Valeria Paz',
  'Diego Fabbri',
  'Martín Sosa',
  'Patricia Núñez',
]

/** Instante UTC de una fecha y hora locales de Argentina (offset fijo -03:00, ADR-019). */
function localToUtc(date: string, time: string): number {
  return new Date(`${date}T${time}:00-03:00`).getTime()
}

/**
 * Parsea el texto de un rango `tstzrange` de Postgres tal como lo devuelve PostgREST, p. ej.
 * `["2026-09-28 09:00:00+00","2026-09-28 13:00:00+00")`, a un par de instantes UTC en
 * milisegundos. Devuelve `null` si el formato no matchea (no debería pasar: la columna
 * `assignments.window` siempre viene poblada por el trigger `app.sync_assignment_window`).
 */
function parseWindowRange(raw: string): { start: number; end: number } | null {
  const match = raw.match(/^[[(]"?([^",]+)"?,"?([^",)]+)"?[)\]]$/)
  if (!match) return null
  const start = new Date(match[1]).getTime()
  const end = new Date(match[2]).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return { start, end }
}

/**
 * Primer empleado del seed sin licencia vigente en `date` y sin ninguna asignación cuya ventana
 * se superponga con la franja pedida (`options.startTime`/`endTime`, por defecto 08:00-12:00
 * local). Lanza si ninguno está libre (no debería pasar con diez cuentas para un solo turno de
 * fixture).
 */
export async function pickSafeEmployee(
  admin: SupabaseClient<Database>,
  date: string,
  options: PickSafeEmployeeOptions | string[] = {},
): Promise<SafeEmployee> {
  // Compatibilidad con la firma anterior (`excludeIds` como tercer argumento posicional): los
  // specs de esta suite que no necesitan una franja distinta de la del fixture típico (08-12)
  // siguen llamando `pickSafeEmployee(admin, date, [firstEmployee.id])`.
  const normalizedOptions: PickSafeEmployeeOptions = Array.isArray(options)
    ? { excludeIds: options }
    : options
  const startTime = normalizedOptions.startTime ?? '08:00'
  const endTime = normalizedOptions.endTime ?? '12:00'
  const excludeIds = normalizedOptions.excludeIds ?? []

  const wantedStart = localToUtc(date, startTime)
  const wantedEnd = localToUtc(date, endTime)

  for (let i = 0; i < SEED_ACCOUNTS.employees.length; i++) {
    const email = SEED_ACCOUNTS.employees[i]
    const id = await resolveUserId(admin, email)
    if (excludeIds.includes(id)) {
      continue
    }

    const { data: leaves } = await admin
      .from('employee_leaves')
      .select('id')
      .eq('employee_id', id)
      .is('deleted_at', null)
      .lte('starts_on', date)
      .or(`ends_on.is.null,ends_on.gte.${date}`)
    if (leaves && leaves.length > 0) {
      continue
    }

    const { data: assignments } = await admin
      .from('assignments')
      .select('window')
      .eq('employee_id', id)
      .eq('shift_date', date)
      .is('removed_at', null)
    const hasOverlap = (assignments ?? []).some((row) => {
      const range = parseWindowRange(String(row.window))
      if (!range) return true // formato inesperado: por las dudas, se descarta el candidato.
      return range.start < wantedEnd && wantedStart < range.end
    })
    if (hasOverlap) {
      continue
    }

    return { id, fullName: EMPLOYEE_FULL_NAMES[i] }
  }
  throw new Error(
    `Ningún empleado del seed está libre el ${date} de ${startTime} a ${endTime} (todos tienen ` +
      'licencia o una asignación que se superpone) -- no se pudo elegir un candidato seguro ' +
      'para el fixture.',
  )
}
