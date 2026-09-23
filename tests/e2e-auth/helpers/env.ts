// tests/e2e-auth/helpers/env.ts — AUTH-012/TEST-003 (P06.4, 08_Fases_y_Backlog.md F6)
//
// Lee y valida las cuatro variables de entorno que necesita esta suite, las mismas que ya usa
// `scripts/seed-dev.ts` y `tests/permissions/helpers/env.ts` (docs/environments.md sección 4):
// VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SEED_DEV_PASSWORD. Se
// leen de `app/.env.local`; nunca se imprime ningún valor.
//
// Por qué esta suite necesita la clave de servicio, a diferencia de `tests/e2e/` (la suite de
// humo): los casos de recuperación y usuario desactivado (AUTH-012) crean y dan de baja cuentas
// descartables con la Admin API (`auth.admin.*`), que solo la clave de servicio puede llamar.

export interface E2eAuthEnv {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  seedPassword: string
}

// `App` (producción): docs/environments.md sección 2. Esta suite nunca corre contra ese
// proyecto (regla 7 del encargo: "Producción nunca, salvo el smoke de F20") — se corta antes de
// abrir ninguna sesión si `.env.local` apuntara mal.
const PRODUCTION_URL_FRAGMENT = 'fysuppdadwvabrjpnnoh'

let cached: E2eAuthEnv | null | undefined

/** `null` si falta alguna variable (para que los specs se salteen solos con `test.skip`). */
export function readE2eAuthEnv(): E2eAuthEnv | null {
  if (cached !== undefined) return cached

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const seedPassword = process.env.SEED_DEV_PASSWORD

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !seedPassword) {
    cached = null
    return null
  }

  if (supabaseUrl.includes(PRODUCTION_URL_FRAGMENT)) {
    throw new Error(
      'VITE_SUPABASE_URL apunta al proyecto de PRODUCCIÓN (App). Esta suite solo corre contra ' +
        'App_dev: se corta acá, antes de abrir ninguna sesión ni crear ningún usuario.',
    )
  }

  cached = { supabaseUrl, anonKey, serviceRoleKey, seedPassword }
  return cached
}

/** Aviso uniforme para saltear un archivo entero cuando falta `.env.local`. */
export const MISSING_ENV_MESSAGE =
  '[tests/e2e-auth] Faltan VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ' +
  'SUPABASE_SERVICE_ROLE_KEY o SEED_DEV_PASSWORD en .env.local. Ver tests/README.md para el ' +
  'comando completo — esta suite no corre en CI ni en los smoke test de despliegue.'
