// tests/e2e-employees/helpers/env.ts — EMP-014/TEST-006 (P09.5, 08_Fases_y_Backlog.md F9)
//
// Lee y valida las cuatro variables de entorno que necesita esta suite, las mismas que ya usan
// `scripts/seed-dev.ts`, `tests/permissions/helpers/env.ts`, `tests/e2e-auth/helpers/env.ts`,
// `tests/e2e-users/helpers/env.ts` y `tests/e2e-clients-sites/helpers/env.ts` (docs/
// environments.md sección 4): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, SEED_DEV_PASSWORD. Se leen de `app/.env.local`; nunca se imprime
// ningún valor. Este archivo es una copia deliberada del de las otras suites (no un import
// cruzado): cada suite de backend real queda autocontenida.
//
// Por qué esta suite necesita la clave de servicio: baja directamente (banea + marca
// `employees.status = terminated`) todas las personas descartables que crea, sin gastar el
// límite de 10 acciones por minuto del dueño en la limpieza (mismo criterio que
// `tests/e2e-users/helpers/adminUsersClient.ts`).

export interface E2eEmployeesEnv {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  seedPassword: string
}

// `App` (producción): docs/environments.md sección 2. Esta suite nunca corre contra ese
// proyecto (regla 7 del encargo: "Producción nunca, salvo el smoke de F20") — se corta antes de
// abrir ninguna sesión si `.env.local` apuntara mal.
const PRODUCTION_URL_FRAGMENT = 'fysuppdadwvabrjpnnoh'

let cached: E2eEmployeesEnv | null | undefined

/** `null` si falta alguna variable (para que los specs se salteen solos con `test.skip`). */
export function readE2eEmployeesEnv(): E2eEmployeesEnv | null {
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
  '[tests/e2e-employees] Faltan VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ' +
  'SUPABASE_SERVICE_ROLE_KEY o SEED_DEV_PASSWORD en .env.local. Ver ' +
  'tests/e2e-employees/README.md para el comando completo — esta suite no corre en CI ni en ' +
  'los smoke test de despliegue.'
