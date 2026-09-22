// tests/permissions/helpers/clients.ts — P04.7
//
// Fábricas de clientes `supabase-js` para la suite de permisos: siempre por API directa (nunca
// por interfaz), tal como pide el encargo. Cada test crea el cliente que necesita con estos
// helpers; ninguno persiste sesión en disco (`persistSession: false`) para no dejar rastros
// entre corridas ni pisar la sesión real de un navegador.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/lib/database.types.ts'
import { readPermissionsTestEnv } from './env.ts'

export type TestClient = SupabaseClient<Database>

function env() {
  const e = readPermissionsTestEnv()
  if (!e) {
    // No debería llamarse nunca con el describe salteado (skipIf), pero si pasa, el mensaje es
    // claro en vez de un `createClient(undefined, undefined)` confuso.
    throw new Error(
      'Faltan variables de entorno; ver tests/permissions/helpers/env.ts.',
    )
  }
  return e
}

/**
 * Cliente con la clave de servicio (`SUPABASE_SERVICE_ROLE_KEY`, bypassa RLS). Se usa SOLO para
 * preparar y verificar datos (contar filas reales, resolver ids por email, confirmar que un
 * `update` bloqueado por RLS de verdad no cambió nada) -- nunca para probar qué puede hacer un
 * rol de aplicación, que es siempre con `loginAs` o `createAnonClient`.
 */
export function createAdminClient(): TestClient {
  const e = env()
  return createClient<Database>(e.supabaseUrl, e.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Cliente sin sesión (`anon`), con la clave publicable. */
export function createAnonClient(): TestClient {
  const e = env()
  return createClient<Database>(e.supabaseUrl, e.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Inicia sesión con un email del seed y `SEED_DEV_PASSWORD` (contraseña compartida de las 14
 * cuentas ficticias de `App_dev`). Devuelve el cliente ya autenticado y el `id` de la persona
 * (== `auth.uid()` == `profiles.id`), para no tener que hardcodear uuids en los specs.
 */
export async function loginAs(
  email: string,
): Promise<{ client: TestClient; userId: string }> {
  const e = env()
  const client = createClient<Database>(e.supabaseUrl, e.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: e.seedPassword,
  })
  if (error || !data.session) {
    throw new Error(
      `No se pudo iniciar sesión como ${email} contra App_dev: ${error?.message ?? 'sin sesión devuelta'}. ` +
        '¿Corriste `pnpm db:seed` y SEED_DEV_PASSWORD coincide con la contraseña real de las cuentas de seed?',
    )
  }
  return { client, userId: data.user.id }
}
