// tests/permissions/helpers/team-lookups.ts — P15.6 (08_Fases_y_Backlog.md F15)
//
// `employee.permissions.ts` y `supervisor.permissions.ts` necesitan un empleado "ajeno" de
// verdad (sin ningún turno en común con la persona principal, hoy) para probar los casos
// negativos de RLS. Hasta P15.6 ese rol lo cumplía siempre `juan.perez` (SEED_ACCOUNTS.employees[1]),
// bajo el supuesto de que el seed nunca lo junta con `maria.gomez`/el equipo de `paula.lemos` en
// un turno de hoy -- supuesto falso en general: `supabase/seed.sql` genera turnos recurrentes a
// partir de plantillas semanales (sección "Fechas relativas a hoy"), así que qué empleados
// comparten turno hoy cambia según el día de la semana en que corra la suite (hallazgo del
// reporte de pausa de P15.6: el 1 oct de verdad junta a juan.perez con el equipo de maria/paula).
//
// En vez de fijar una fecha futura (acá hace falta el estado REAL de hoy: la regla que se
// prueba es sobre turnos de hoy, P-103 y "empleados de sus turnos"), este helper busca en el
// pool de empleados del seed uno que, en este preciso momento, no tenga ningún turno vigente en
// común con los `shiftIds` dados -- funciona sin importar qué día de la semana sea.
import { SEED_ACCOUNTS } from '../fixtures/seed-accounts.ts'
import { resolveUserId } from './admin-lookups.ts'
import type { TestClient } from './clients.ts'

/**
 * Turnos vigentes (asignación no removida) de un empleado, por su `profile_id`.
 */
export async function fetchVigentShiftIds(
  admin: TestClient,
  employeeId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from('assignments')
    .select('shift_id')
    .eq('employee_id', employeeId)
    .is('removed_at', null)
  if (error) {
    throw new Error(`No se pudieron leer los turnos vigentes: ${error.message}`)
  }
  return ((data ?? []) as { shift_id: string }[]).map((row) => row.shift_id)
}

/**
 * Turnos vigentes (no cancelados) que supervisa una persona, por su `profile_id` de supervisor.
 */
export async function fetchSupervisedShiftIds(
  admin: TestClient,
  supervisorId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from('supervisions')
    .select('shift_id')
    .eq('supervisor_id', supervisorId)
    .neq('status', 'cancelled')
  if (error) {
    throw new Error(
      `No se pudieron leer los turnos supervisados: ${error.message}`,
    )
  }
  return ((data ?? []) as { shift_id: string }[]).map((row) => row.shift_id)
}

/**
 * Busca, en el pool de empleados del seed (`SEED_ACCOUNTS.employees`), uno que no tenga ninguna
 * asignación vigente sobre los `shiftIds` dados -- es decir, alguien "ajeno" de verdad a esos
 * turnos en este momento. Descarta `excludeProfileId` (la propia persona principal) del pool.
 * Tira error si ningún empleado del seed cumple la condición (no debería pasar: el seed tiene
 * decenas de empleados y los `shiftIds` de una sola persona son pocos).
 */
export async function findEmployeeWithoutSharedShifts(
  admin: TestClient,
  shiftIds: string[],
  excludeProfileId: string,
): Promise<string> {
  for (const account of SEED_ACCOUNTS.employees) {
    const candidateId = await resolveUserId(admin, account)
    if (candidateId === excludeProfileId) continue
    if (shiftIds.length === 0) return candidateId
    const { count, error } = await admin
      .from('assignments')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', candidateId)
      .in('shift_id', shiftIds)
      .is('removed_at', null)
    if (error) {
      throw new Error(
        `No se pudo verificar los turnos de ${account}: ${error.message}`,
      )
    }
    if ((count ?? 0) === 0) return candidateId
  }
  throw new Error(
    'No se encontró, en el pool de empleados del seed, ninguno sin turnos en común con los `shiftIds` dados.',
  )
}
