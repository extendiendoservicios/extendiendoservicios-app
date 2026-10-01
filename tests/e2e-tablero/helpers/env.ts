// tests/e2e-tablero/helpers/env.ts — DASH-008/DASH-009 (P16.2)
//
// Lee y valida las cuatro variables de entorno de las suites de backend real, de
// `app/.env.local`. Nunca se imprime ningún valor. Copia deliberada de las demás suites (cada una
// queda autocontenida).

export interface E2eTableroEnv {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  seedPassword: string
}

// `App` (producción): docs/environments.md sección 2. Esta suite nunca corre contra ese proyecto.
const PRODUCTION_URL_FRAGMENT = 'fysuppdadwvabrjpnnoh'

let cached: E2eTableroEnv | null | undefined

/** `null` si falta alguna variable (los specs se saltean solos con `test.skip`). */
export function readE2eTableroEnv(): E2eTableroEnv | null {
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
        'App_dev: se corta acá, antes de abrir ninguna sesión ni crear ningún dato.',
    )
  }

  cached = { supabaseUrl, anonKey, serviceRoleKey, seedPassword }
  return cached
}

export const MISSING_ENV_MESSAGE =
  '[tests/e2e-tablero] Faltan VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ' +
  'SUPABASE_SERVICE_ROLE_KEY o SEED_DEV_PASSWORD en .env.local. Ver tests/e2e-tablero/README.md ' +
  '— esta suite no corre en CI ni en los smoke test de despliegue.'
