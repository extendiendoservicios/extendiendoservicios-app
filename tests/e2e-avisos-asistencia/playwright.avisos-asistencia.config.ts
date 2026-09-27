import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_AVISOS_ASISTENCIA_BASE_URL } from './helpers/baseUrl.ts'

// Mismo motivo que el resto de las suites de backend real: Playwright arranca
// `webServer.command` con el directorio de este archivo como `cwd` por omisión, no la raíz de
// `app/` — hay que fijarlo a mano para que `vite preview` encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// ABS-007/ATT-015/TEST-011 (P14.4, 08_Fases_y_Backlog.md F14): e2e de avisos del empleado
// (EMP-12) y de asistencia administrativa (ADM-10/ADM-11/ADM-06/ADM-12), contra un backend real
// (App_dev). Dos proyectos: `mobile` (390×844, geolocalización no aplica acá pero se mantiene el
// mismo viewport que el resto de la vía del empleado) para EMP-12, y `desktop` para la vía de
// administración -- que además se recorre una vez a 390 px dentro del mismo archivo
// (`admin-attendance-mobile.spec.ts`, ATT-016) para la revisión responsive de ADM-10/ADM-11.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // datos descartables por test, sin necesidad de paralelismo acá.
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 90_000,
  use: {
    baseURL: E2E_AVISOS_ASISTENCIA_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 5173',
    cwd: APP_ROOT,
    url: E2E_AVISOS_ASISTENCIA_BASE_URL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'mobile',
      testMatch: [
        'employee-notices.spec.ts',
        'admin-attendance-mobile.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      testMatch: ['admin-attendance.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
})
