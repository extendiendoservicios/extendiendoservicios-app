import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_TABLERO_BASE_URL } from './helpers/baseUrl.ts'

// Mismo motivo que el resto de las suites de backend real: Playwright arranca
// `webServer.command` con el directorio de este archivo como `cwd` por omisión, no la raíz de
// `app/` — hay que fijarlo a mano para que `vite preview` encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// DASH-008/DASH-009/TEST-013 (P16.2, 08_Fases_y_Backlog.md F16): e2e y rendimiento del tablero
// operativo (ADM-02) contra un backend real (App_dev). Dos proyectos:
//  - `desktop` (1280×900): escenario, acciones, permisos, todas las alertas y el rendimiento.
//  - `mobile` (390×844): KPIs en dos columnas, cinco alertas con "Ver las N", acciones al pie.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // datos descartables por test; el tablero cuenta TODO lo de hoy.
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 120_000,
  use: {
    baseURL: E2E_TABLERO_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 5173',
    cwd: APP_ROOT,
    url: E2E_TABLERO_BASE_URL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'desktop',
      testMatch: ['dashboard-desktop.spec.ts', 'dashboard-performance.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: 'mobile',
      testMatch: ['dashboard-mobile.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
})
