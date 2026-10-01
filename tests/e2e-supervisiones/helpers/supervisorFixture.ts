// tests/e2e-supervisiones/helpers/supervisorFixture.ts — MOB-SUP-013 (P15.6)
//
// Atajo sobre `peopleFixture.ts` para la persona principal de esta suite: un supervisor
// descartable, con su ficha de `employees` ya creada (la exige `v_employees`/ADM-14, ver el
// comentario de `createDisposablePerson`). Nombre de archivo pedido por el encargo
// ("supervisorFixture.ts", igual patrón que `employeeFixture.ts` de otras vías).

import type { AdminClient } from './adminClient.ts'
import {
  createDisposablePerson,
  deactivateDisposablePerson,
  type DisposablePerson,
} from './peopleFixture.ts'

export type DisposableSupervisor = DisposablePerson

export async function createDisposableSupervisor(
  admin: AdminClient,
  slug: string,
  seedPassword: string,
): Promise<DisposableSupervisor> {
  return createDisposablePerson(admin, slug, 'supervisor', seedPassword)
}

export async function deactivateDisposableSupervisor(
  admin: AdminClient,
  profileId: string,
): Promise<void> {
  await deactivateDisposablePerson(admin, profileId)
}
