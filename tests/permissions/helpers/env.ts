// tests/permissions/helpers/env.ts — P04.7 (08_Fases_y_Backlog.md, F4 · verificación
// independiente del criterio de aceptación)
//
// Lee y valida las cuatro variables de entorno que necesita la suite de permisos, las mismas
// que ya usa `scripts/seed-dev.ts` (docs/environments.md sección 4): VITE_SUPABASE_URL,
// VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SEED_DEV_PASSWORD. Se leen de `.env.local`
// con `node --env-file=.env.local` (ver tests/permissions/README.md para el comando exacto);
// nunca se imprime ningún valor, solo el NOMBRE de lo que falta.
//
// Por qué `.env.local` y no `.env.test.local`: el encargo P04.7 (que es quien definió el alcance
// de este primer esqueleto) indica explícitamente que la clave de servicio y la contraseña
// compartida del seed viven en `app/.env.local` -- el mismo archivo que ya usan
// `scripts/seed-dev.ts` y el resto de la app para hablar con `App_dev`, sin duplicar variables
// en un segundo archivo. Las reglas generales del rol mencionan `.env.test.local`: queda
// anotado como pregunta en el reporte de esta tarea para que el orquestador defina cuál es la
// convención a partir de acá (P18.3, cuando esta suite crezca a la versión completa de
// TEST-019, es un buen momento para unificarlo).
//
// Doble capa para que la suite nunca rompa el CI (regla del encargo):
//   1. Los archivos de esta carpeta usan la extensión `.permissions.ts` (no `.test.ts` ni
//      `.spec.ts`), así que quedan fuera del include por defecto de Vitest
//      (`**/*.{test,spec}.*`) y `pnpm test` (que corre en CI sin `.env.local`) ni siquiera los
//      descubre. Ver tests/permissions/vitest.config.ts.
//   2. Además, cada archivo llama a `readPermissionsTestEnv()` y usa `describe.skipIf(!env)`: si
//      alguien corre esta suite a mano sin `.env.local` completo, los tests se saltean solos con
//      un aviso legible por consola, en vez de fallar con un error de red confuso.

export interface PermissionsTestEnv {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  seedPassword: string
}

// App (producción): docs/environments.md sección 2. Nunca se corre esta suite contra este
// proyecto (regla 1 del encargo P04.7) -- se corta antes de abrir ninguna sesión si algún día
// `.env.local` apunta mal, mismo criterio que `scripts/seed-dev.ts`.
const PRODUCTION_URL_FRAGMENT = 'fysuppdadwvabrjpnnoh'

let cached: PermissionsTestEnv | null | undefined

/** `null` si falta alguna variable (para que los specs se salteen solos). */
export function readPermissionsTestEnv(): PermissionsTestEnv | null {
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
      'VITE_SUPABASE_URL apunta al proyecto de PRODUCCIÓN (App). La suite de permisos solo ' +
        'corre contra App_dev o staging (regla 1 del encargo P04.7): se corta acá, antes de ' +
        'abrir ninguna sesión ni tocar ningún dato.',
    )
  }

  cached = { supabaseUrl, anonKey, serviceRoleKey, seedPassword }
  return cached
}

/** Mensaje de aviso uniforme para el `console.warn` que precede a cada `describe.skipIf`. */
export function missingEnvWarning(archivo: string): string {
  return (
    `[tests/permissions] Salteando ${archivo}: faltan VITE_SUPABASE_URL, ` +
    'VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY o SEED_DEV_PASSWORD en .env.local. ' +
    'Ver tests/permissions/README.md para el comando completo.'
  )
}
