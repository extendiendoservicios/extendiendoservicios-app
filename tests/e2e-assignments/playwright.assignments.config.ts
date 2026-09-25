import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_ASSIGNMENTS_BASE_URL } from './helpers/baseUrl.ts'

// Mismo motivo que el resto de las suites de backend real: Playwright arranca
// `webServer.command` con el directorio de este archivo como `cwd` por omisión, no la raíz de
// `app/` — hay que fijarlo a mano para que `vite preview` encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// ASSIGN-015/ASSIGN-016/TEST-008 (P11.4, 08_Fases_y_Backlog.md F11): e2e de asignaciones y
// cronograma contra un backend real (App_dev), en su propia carpeta por el mismo motivo que las
// demás suites de backend real (ver sus propios README): necesita `SUPABASE_SERVICE_ROLE_KEY`
// para armar y limpiar clientes, sedes y turnos descartables. Puerto propio 4176 (no 5173): esta
// suite no invoca ninguna Edge Function desde el navegador (ver `helpers/baseUrl.ts`).
//
// `pnpm test:e2e:assignments` corre `pnpm build` primero (carga `.env.local` con la convención
// de Vite, así apunta de verdad a `App_dev`) y recién después Playwright, que sirve ese `dist/`
// con `vite preview --port 4176`.
//
// Solo `chromium` y `mobile` (390 px): mismo patrón que el resto de suites de backend real de
// este repo (ninguna usa `webkit` todavía) -- se documenta en el reporte del encargo como nota
// para el orquestador, ya que la guía de este rol pide `chromium`, `webkit` y `mobile`.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // datos descartables por test, sin necesidad de paralelismo acá.
  workers: 1,
  retries: 0,
  reporter: 'html',
  timeout: 90_000,
  use: {
    baseURL: E2E_ASSIGNMENTS_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 4176',
    cwd: APP_ROOT,
    url: E2E_ASSIGNMENTS_BASE_URL,
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
      // El spec móvil corre solo en el proyecto `mobile` (ver más abajo): sin este
      // `testIgnore`, `testMatch` por omisión ('**/*.spec.ts') lo corría también acá, dos veces
      // el mismo turno de fixture en el mismo proceso -- innecesario (ya se prueba el flujo de
      // escritorio en los otros specs) y, si corre `fullyParallel: false` en orden, duplica
      // datos de fixture sin aportar nada nuevo.
      testIgnore: '**/mobile-day-list-assign.spec.ts',
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        geolocation: { latitude: -34.6037, longitude: -58.3816 },
        permissions: ['geolocation'],
      },
      // Solo el spec que prueba el criterio de aceptación de F11 en celular (asignar desde la
      // lista del día a 390 px) corre en este proyecto: el resto de specs de esta carpeta son
      // recorridos de escritorio sin nada nuevo que ver en otro ancho.
      testMatch: '**/mobile-day-list-assign.spec.ts',
    },
  ],
})
