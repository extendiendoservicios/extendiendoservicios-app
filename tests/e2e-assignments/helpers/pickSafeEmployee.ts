// tests/e2e-assignments/helpers/pickSafeEmployee.ts — ASSIGN-015 (P11.4)
//
// Elige, de las diez cuentas de empleado del seed, la primera SIN conflicto real para una fecha
// dada (sin licencia vigente ese día, sin ninguna asignación vigente ese día): los specs de esta
// suite que no están probando conflictos a propósito (solo quieren que la asignación se cree sin
// sorpresas) no pueden asumir que un nombre fijo ("Carlos Medina", "Lucía Torres") esté siempre
// libre -- el seed de `App_dev` tiene licencias y asignaciones reales que cambian con el tiempo,
// y el criterio de F11 exige que la suite sea estable, no que dependa de memorizar el estado
// actual de cada persona (encontrado armando esta suite, ver el reporte del encargo P11.4).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/lib/database.types.ts'
import { SEED_ACCOUNTS } from '../../permissions/fixtures/seed-accounts.ts'
import { resolveUserId } from '../../permissions/helpers/admin-lookups.ts'

export interface SafeEmployee {
  id: string
  /** Nombre completo tal como aparece en la interfaz (`PersonCell`), para filtrar el candidato. */
  fullName: string
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

/**
 * Primer empleado del seed sin licencia vigente ni asignación vigente en `date`
 * (`"YYYY-MM-DD"`). Lanza si ninguno está libre (no debería pasar con diez cuentas para un solo
 * turno de fixture).
 */
export async function pickSafeEmployee(
  admin: SupabaseClient<Database>,
  date: string,
  excludeIds: string[] = [],
): Promise<SafeEmployee> {
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
      .select('id')
      .eq('employee_id', id)
      .eq('shift_date', date)
      .is('removed_at', null)
    if (assignments && assignments.length > 0) {
      continue
    }

    return { id, fullName: EMPLOYEE_FULL_NAMES[i] }
  }
  throw new Error(
    `Ningún empleado del seed está libre el ${date} (todos tienen licencia o asignación) -- ` +
      'no se pudo elegir un candidato seguro para el fixture.',
  )
}
