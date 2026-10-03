// tests/fixtures/env.ts — TEST-015/TEST-016 (P18.1)
//
// Lectura y validación de las cuatro variables de `app/.env.local` que usan todas las suites de
// backend real (las mismas que `scripts/seed-dev.ts`). Nunca se imprime ningún valor.
// Es la versión compartida: las suites viejas (`tests/e2e-*/helpers/env.ts`) tienen cada una su
// copia; las de F18 usan esta.

export interface E2eEnv {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  seedPassword: string
}

// `App` (producción), docs/environments.md sección 2: nunca se corre contra ese proyecto.
const PRODUCTION_URL_FRAGMENT = 'fysuppdadwvabrjpnnoh'

/**
 * Origen del build local para las suites de backend real. Es el puerto 5173 y no otro porque la
 * lista blanca de CORS de la Edge Function `admin-users` (`supabase/functions/_shared/cors.ts`)
 * solo admite `http://localhost:5173` como origen local.
 */
export const E2E_BASE_URL = 'http://localhost:5173'

let cached: E2eEnv | null | undefined

/** `null` si falta alguna variable (los specs se saltean solos con `test.skip`). */
export function readE2eEnv(): E2eEnv | null {
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
      'VITE_SUPABASE_URL apunta al proyecto de PRODUCCIÓN (App). Estas suites solo corren contra ' +
        'App_dev: se corta acá, antes de abrir ninguna sesión ni crear ningún dato.',
    )
  }

  cached = { supabaseUrl, anonKey, serviceRoleKey, seedPassword }
  return cached
}

/** Igual que `readE2eEnv` pero corta con un mensaje claro si falta algo (setup y fixtures). */
export function requireE2eEnv(): E2eEnv {
  const env = readE2eEnv()
  if (!env) throw new Error(MISSING_ENV_MESSAGE)
  return env
}

export const MISSING_ENV_MESSAGE =
  '[tests/fixtures] Faltan VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY o ' +
  'SEED_DEV_PASSWORD en .env.local. Estas suites no corren en CI ni en los smoke test de despliegue.'

/**
 * Clave de `localStorage` donde `supabase-js` guarda la sesión: `sb-<primer tramo del host>-auth-token`.
 */
export function authStorageKey(supabaseUrl: string): string {
  const host = new URL(supabaseUrl).hostname
  return `sb-${host.split('.')[0]}-auth-token`
}
