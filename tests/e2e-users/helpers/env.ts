// tests/e2e-users/helpers/env.ts — USERS-018/TEST-004 (P07.4, 08_Fases_y_Backlog.md F7)
//
// Lee y valida las cuatro variables de entorno que necesita esta suite, las mismas que ya usan
// `scripts/seed-dev.ts`, `tests/permissions/helpers/env.ts` y `tests/e2e-auth/helpers/env.ts`
// (docs/environments.md sección 4): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, SEED_DEV_PASSWORD. Se leen de `app/.env.local`; nunca se imprime
// ningún valor. Este archivo es una copia deliberada del de `tests/e2e-auth/` (no un import
// cruzado): cada suite de backend real queda autocontenida y no depende de que la otra exista.
//
// Por qué esta suite necesita la clave de servicio: crea y da de baja administradores
// descartables con la Admin API (`auth.admin.*`) y llama a la Edge Function `admin-users` por
// API directa (no solo por UI) para los casos de permisos negativos (USERS-018: "administrador
// no puede crear otro administrador ni reactivar a nadie", "último dueño no se puede
// desactivar").

export interface E2eUsersEnv {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  seedPassword: string
}

// `App` (producción): docs/environments.md sección 2. Esta suite nunca corre contra ese
// proyecto (regla 7 del encargo: "Producción nunca, salvo el smoke de F20") — se corta antes de
// abrir ninguna sesión si `.env.local` apuntara mal.
const PRODUCTION_URL_FRAGMENT = 'fysuppdadwvabrjpnnoh'

let cached: E2eUsersEnv | null | undefined

/** `null` si falta alguna variable (para que los specs se salteen solos con `test.skip`). */
export function readE2eUsersEnv(): E2eUsersEnv | null {
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
  '[tests/e2e-users] Faltan VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ' +
  'SUPABASE_SERVICE_ROLE_KEY o SEED_DEV_PASSWORD en .env.local. Ver tests/e2e-users/README.md ' +
  'para el comando completo — esta suite no corre en CI ni en los smoke test de despliegue.'
