// tests/e2e-avisos-asistencia/helpers/env.ts — ABS-007/ATT-015/TEST-011 (P14.4,
// 08_Fases_y_Backlog.md F14)
//
// Lee y valida las cuatro variables de entorno que necesita esta suite, las mismas que usan
// `scripts/seed-dev.ts` y el resto de suites de backend real. Se leen de `app/.env.local`; nunca
// se imprime ningún valor. Copia deliberada de `tests/e2e-employee-shift/helpers/env.ts` (no un
// import cruzado): cada suite de backend real queda autocontenida.

export interface E2eAvisosAsistenciaEnv {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  seedPassword: string
}

// `App` (producción): docs/environments.md sección 2. Esta suite nunca corre contra ese proyecto
// (regla del encargo: "Solo App_dev; nunca producción") — se corta antes de abrir ninguna sesión
// si `.env.local` apuntara mal.
const PRODUCTION_URL_FRAGMENT = 'fysuppdadwvabrjpnnoh'

let cached: E2eAvisosAsistenciaEnv | null | undefined

/** `null` si falta alguna variable (para que los specs se salteen solos con `test.skip`). */
export function readE2eAvisosAsistenciaEnv(): E2eAvisosAsistenciaEnv | null {
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
  '[tests/e2e-avisos-asistencia] Faltan VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ' +
  'SUPABASE_SERVICE_ROLE_KEY o SEED_DEV_PASSWORD en .env.local. Ver ' +
  'tests/e2e-avisos-asistencia/README.md para el comando completo — esta suite no corre en CI ni ' +
  'en los smoke test de despliegue.'
