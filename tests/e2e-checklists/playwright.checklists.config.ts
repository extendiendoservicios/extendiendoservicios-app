import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_CHECKLISTS_BASE_URL } from './helpers/baseUrl.ts'

// Mismo motivo que el resto de las suites de backend real: Playwright arranca
// `webServer.command` con el directorio de este archivo como `cwd` por omisión, no la raíz de
// `app/` — hay que fijarlo a mano para que `vite preview` encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// TASK-008/TEST-009 (P12.3, 08_Fases_y_Backlog.md F12): e2e de checklists y tareas contra un
// backend real (App_dev), en su propia carpeta por el mismo motivo que las demás suites de
// backend real (ver sus propios README): necesita `SUPABASE_SERVICE_ROLE_KEY` para armar y
// limpiar clientes, sedes, plantillas y turnos descartables. Puerto propio 4177 (no 5173): esta
// suite no invoca ninguna Edge Function desde el navegador (ver `helpers/baseUrl.ts`).
//
// `pnpm test:e2e:checklists` corre `pnpm build` primero (carga `.env.local` con la convención de
// Vite, así apunta de verdad a `App_dev`) y recién después Playwright, que sirve ese `dist/` con
// `vite preview --port 4177`.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // datos descartables por test, sin necesidad de paralelismo acá.
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 90_000,
  use: {
    baseURL: E2E_CHECKLISTS_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 4177',
    cwd: APP_ROOT,
    url: E2E_CHECKLISTS_BASE_URL,
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
      // El spec móvil corre solo en el proyecto `mobile` (ver más abajo): sin este `testIgnore`,
      // `testMatch` por omisión ('**/*.spec.ts') lo corría también acá, dos veces el mismo
      // fixture en el mismo proceso -- innecesario (el flujo de escritorio ya se prueba en el
      // otro spec).
      testIgnore: '**/mobile-*.spec.ts',
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
      // Solo el spec que prueba el caso de aceptación a 390 px de ADM-26 y de las tareas de
      // ADM-06 corre en este proyecto: el resto de specs de esta carpeta son recorridos de
      // escritorio sin nada nuevo que ver en otro ancho.
      testMatch: '**/mobile-*.spec.ts',
    },
  ],
})
