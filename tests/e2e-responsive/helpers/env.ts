// tests/e2e-responsive/helpers/env.ts — RESP-003 a RESP-007 (P17.2)
//
// Lee y valida las cuatro variables de entorno de las suites de backend real, de
// `app/.env.local`. Nunca se imprime ningún valor. Copia deliberada de las demás suites (cada una
// queda autocontenida).

export interface E2eResponsiveEnv {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  seedPassword: string
}

// `App` (producción): docs/environments.md sección 2. Esta suite nunca corre contra ese proyecto.
const PRODUCTION_URL_FRAGMENT = 'fysuppdadwvabrjpnnoh'

let cached: E2eResponsiveEnv | null | undefined

/** `null` si falta alguna variable (los specs se saltean solos con `test.skip`). */
export function readE2eResponsiveEnv(): E2eResponsiveEnv | null {
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
  '[tests/e2e-responsive] Faltan VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ' +
  'SUPABASE_SERVICE_ROLE_KEY o SEED_DEV_PASSWORD en .env.local. Ver tests/e2e-responsive/README.md ' +
  '— esta suite no corre en CI ni en los smoke test de despliegue.'
