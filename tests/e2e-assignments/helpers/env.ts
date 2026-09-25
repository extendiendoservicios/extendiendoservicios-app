// tests/e2e-assignments/helpers/env.ts — ASSIGN-015/ASSIGN-016/TEST-008 (P11.4,
// 08_Fases_y_Backlog.md F11)
//
// Lee y valida las cuatro variables de entorno que necesita esta suite, las mismas que ya usan
// `scripts/seed-dev.ts` y el resto de suites de backend real (`tests/e2e-auth/`,
// `tests/e2e-users/`, `tests/e2e-clients-sites/`, `tests/e2e-employees/`,
// `tests/e2e-shifts-services/`): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, SEED_DEV_PASSWORD. Se leen de `app/.env.local`; nunca se imprime
// ningún valor. Copia deliberada de esas suites (no un import cruzado): cada suite de backend
// real queda autocontenida.

export interface E2eAssignmentsEnv {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  seedPassword: string
}

// `App` (producción): docs/environments.md sección 2. Esta suite nunca corre contra ese
// proyecto (regla 7 del encargo: "Producción nunca") — se corta antes de abrir ninguna sesión
// si `.env.local` apuntara mal.
const PRODUCTION_URL_FRAGMENT = 'fysuppdadwvabrjpnnoh'

let cached: E2eAssignmentsEnv | null | undefined

/** `null` si falta alguna variable (para que los specs se salteen solos con `test.skip`). */
export function readE2eAssignmentsEnv(): E2eAssignmentsEnv | null {
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

/** Aviso uniforme para saltear un archivo entero cuando falta `.env.local`. */
export const MISSING_ENV_MESSAGE =
  '[tests/e2e-assignments] Faltan VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ' +
  'SUPABASE_SERVICE_ROLE_KEY o SEED_DEV_PASSWORD en .env.local. Ver ' +
  'tests/e2e-assignments/README.md para el comando completo — esta suite no corre en CI ni en ' +
  'los smoke test de despliegue.'
