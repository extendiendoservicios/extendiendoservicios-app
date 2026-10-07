// tests/e2e-ajustes-reunion/helpers/nombres.ts — P19.5d
//
// Lectura y reposición de nombres (AJ-01). Los tests cambian el nombre de cuentas fijas y del
// dueño del seed; cada uno lo repone en su `finally`.

import { getAdminDb } from '../../fixtures/accounts.ts'
import { sessionClient } from '../../fixtures/scenario.ts'

export interface NombreGuardado {
  id: string
  firstName: string
  lastName: string
}

export async function leerNombre(id: string): Promise<NombreGuardado> {
  const { data, error } = await getAdminDb()
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', id)
    .single()
  if (error || !data) {
    throw new Error(`No se pudo leer el nombre de ${id}: ${error?.message}`)
  }
  return { id, firstName: data.first_name, lastName: data.last_name }
}

/**
 * Repone el nombre original. El trigger de columnas propias de `profiles` solo deja pasar el
 * nombre dentro de `update_person_name`, así que se usa la RPC con la sesión del dueño (la misma
 * puerta que usa la aplicación). Deja un evento `name_changed` más: es el rastro honesto de la
 * reposición.
 */
export async function reponerNombre(original: NombreGuardado): Promise<void> {
  const actual = await leerNombre(original.id)
  if (
    actual.firstName === original.firstName &&
    actual.lastName === original.lastName
  ) {
    return
  }
  const owner = await sessionClient('owner')
  const { error } = await owner.rpc('update_person_name', {
    p_profile_id: original.id,
    p_first_name: original.firstName,
    p_last_name: original.lastName,
  })
  if (error) {
    throw new Error(
      `No se pudo reponer el nombre de ${original.id}: ${error.message}`,
    )
  }
}
