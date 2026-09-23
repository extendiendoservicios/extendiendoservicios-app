import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_USERS_BASE_URL } from './helpers/baseUrl.ts'

// Mismo motivo que `tests/e2e-auth/playwright.auth.config.ts`: Playwright arranca
// `webServer.command` con el directorio de este archivo como `cwd` por omisión
// (`tests/e2e-users/`), no la raíz de `app/` — hay que fijarlo a mano para que `vite preview`
// encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// USERS-018/TEST-004 (P07.4, 08_Fases_y_Backlog.md F7): e2e de usuarios, roles, capacidades y
// configuración de la empresa contra un backend real (App_dev), en su propia carpeta por el
// mismo motivo que `tests/e2e-auth/` (ver el comentario largo de ese archivo): necesita
// `SUPABASE_SERVICE_ROLE_KEY` para crear y dar de baja cuentas descartables, algo que ni
// `ci.yml` ni los workflows de despliegue tienen ni deberían tener.
//
// Puerto 5173 (no uno propio): ver el comentario largo de `helpers/baseUrl.ts` -- lo exige la
// lista blanca de CORS de la Edge Function `admin-users`, que esta suite sí invoca desde el
// navegador (a diferencia de `tests/e2e-auth/`).
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // cuentas descartables por test, y el límite de 10 acciones/min del dueño: sin paralelismo acá.
  workers: 1,
  retries: 0,
  reporter: 'html',
  timeout: 60_000,
  use: {
    baseURL: E2E_USERS_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 5173',
    cwd: APP_ROOT,
    url: E2E_USERS_BASE_URL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
      // Solo el recorrido principal corre también a 390 px (regla del encargo: "Probá a 1280 px
      // y, al menos para el recorrido principal, a 390 px"). El resto de los specs de esta
      // carpeta son de permisos por API directa o de lectura simple del dueño, sin nada nuevo
      // que ver en otro ancho -- correrlos dos veces solo duplicaría llamadas a la Edge Function
      // `admin-users` y consumiría el límite de 10 acciones por minuto sin agregar cobertura.
      testMatch: '**/owner-creates-admin-and-capabilities.spec.ts',
    },
  ],
})
