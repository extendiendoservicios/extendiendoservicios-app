// tests/permissions/helpers/admin-lookups.ts — P04.7
//
// Consultas de solo lectura con el cliente admin (clave de servicio) para resolver datos del
// seed en tiempo de ejecución -- nunca se hardcodean uuids en los specs: el seed es idempotente
// pero regenera algunas fechas y no garantiza los mismos ids entre corridas de `pnpm db:seed`.

import type { User } from '@supabase/supabase-js'
import type { TestClient } from './clients.ts'

/**
 * Id de perfil (`profiles.id` == `auth.users.id`) de una cuenta del seed, buscada por email. Usa
 * la Admin API de Auth (`auth.admin.listUsers`) para no depender de que la política RLS de
 * `profiles` le muestre esa fila al cliente admin (la tiene, bypassa RLS, pero así queda
 * explícito que la fuente es Auth, la misma que usa `scripts/seed-dev.ts`).
 *
 * Recorre TODAS las páginas (`perPage: 1000`, y sigue pidiendo páginas mientras vengan llenas):
 * `listUsers()` sin argumentos solo trae la primera página (50 usuarios, orden más nuevo
 * primero) -- con las cuentas del seed entre las más viejas de `App_dev`, esta función dejaba de
 * encontrarlas apenas se acumularon más de 50 usuarios en el proyecto (132 cuentas `e2e-*`
 * encontradas sin dar de baja al armar P10.4, de corridas anteriores de otras suites -- ver el
 * reporte del encargo). Bug real, no solo de esta función: sin este arreglo, CUALQUIER suite que
 * llame `resolveUserId` puede fallar de forma intermitente según cuántas cuentas descartables
 * haya sin limpiar en el momento de correrla.
 */
export async function resolveUserId(
  admin: TestClient,
  email: string,
): Promise<string> {
  const normalizedEmail = email.toLowerCase()
  const perPage = 1000
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) {
      throw new Error(
        `No se pudo listar usuarios de Auth para resolver ${email}: ${error.message}`,
      )
    }
    const user = data.users.find(
      (u: User) => u.email?.toLowerCase() === normalizedEmail,
    )
    if (user) {
      return user.id
    }
    if (data.users.length < perPage) {
      break // última página: no hace falta seguir pidiendo.
    }
  }
  throw new Error(
    `No se encontró en Auth ningún usuario con el email ${email}. ¿Corriste \`pnpm db:seed\`?`,
  )
}
