import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_EMPLOYEE_SHIFT_BASE_URL } from './helpers/baseUrl.ts'

// Mismo motivo que el resto de las suites de backend real: Playwright arranca
// `webServer.command` con el directorio de este archivo como `cwd` por omisión, no la raíz de
// `app/` — hay que fijarlo a mano para que `vite preview` encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// MOB-EMP-017/TEST-010 (P13.4, 08_Fases_y_Backlog.md F13): e2e móvil del turno completo del
// empleado, con y sin geolocalización, contra un backend real (App_dev). Un solo proyecto a
// 390×844 (el encargo pide "proyecto móvil de Playwright" -- sin variante de escritorio, esta
// vía es exclusivamente móvil, DS-015/MOB-EMP-016). La geolocalización se concede o no por
// `test.use()` en cada archivo (algunos casos necesitan permiso concedido y una posición
// simulada; el caso "sin geolocalización" necesita el permiso SIN conceder para que el navegador
// deniegue solo, sin diálogo).
//
// `pnpm test:e2e:employee-shift` (a falta de un script en package.json, ver el reporte de esta
// tarea) corre `pnpm build` primero (carga `.env.local` con la convención de Vite, así apunta de
// verdad a `App_dev`) y recién después Playwright, que sirve ese `dist/` con
// `vite preview --port 5173`.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // datos descartables por test, sin necesidad de paralelismo acá.
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 90_000,
  use: {
    baseURL: E2E_EMPLOYEE_SHIFT_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 5173',
    cwd: APP_ROOT,
    url: E2E_EMPLOYEE_SHIFT_BASE_URL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
})
