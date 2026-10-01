// tests/e2e-supervisiones/helpers/employeeFixture.ts — SUP-013/MOB-SUP-013 (P15.6)
//
// Atajo sobre `peopleFixture.ts` para los empleados descartables que completan los turnos de
// fixture (a calificar, o el "compañero" que deja el cálculo de "falta 1 empleado por
// calificar" en MOB-SUP-013). Mismo nombre de archivo que el resto de suites de esta vía
// (`tests/e2e-employee-shift/helpers/employeeFixture.ts`, `tests/e2e-avisos-asistencia/helpers/employeeFixture.ts`).

import type { AdminClient } from './adminClient.ts'
import {
  createDisposablePerson,
  deactivateDisposablePerson,
  type DisposablePerson,
} from './peopleFixture.ts'

export type DisposableEmployee = DisposablePerson

export async function createDisposableEmployee(
  admin: AdminClient,
  slug: string,
  seedPassword: string,
): Promise<DisposableEmployee> {
  return createDisposablePerson(admin, slug, 'employee', seedPassword)
}

export async function deactivateDisposableEmployee(
  admin: AdminClient,
  profileId: string,
): Promise<void> {
  await deactivateDisposablePerson(admin, profileId)
}
