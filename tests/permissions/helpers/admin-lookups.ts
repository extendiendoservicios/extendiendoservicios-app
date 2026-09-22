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
 */
export async function resolveUserId(
  admin: TestClient,
  email: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.listUsers()
  if (error) {
    throw new Error(
      `No se pudo listar usuarios de Auth para resolver ${email}: ${error.message}`,
    )
  }
  const user = data.users.find(
    (u: User) => u.email?.toLowerCase() === email.toLowerCase(),
  )
  if (!user) {
    throw new Error(
      `No se encontró en Auth ningún usuario con el email ${email}. ¿Corriste \`pnpm db:seed\`?`,
    )
  }
  return user.id
}
