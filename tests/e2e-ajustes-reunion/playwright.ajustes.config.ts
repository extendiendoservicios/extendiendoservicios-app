import './conjunto.ts'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_BASE_URL } from '../fixtures/env.ts'
import { POSICION_SIMULADA } from '../fixtures/movil.ts'

// `vite preview` arranca con el directorio del config como `cwd` por omisión: hay que fijarlo a la
// raíz de `app/` para que encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// P19.5d (F19): e2e de los ajustes pedidos por los dueños en la reunión del 6 oct 2026 contra
// `App_dev` (AJ-01 a AJ-10). Los archivos terminan en `.desktop.ts` (administración, 1280 px) o
// `.movil.ts` (celular, 390 px, geolocalización concedida); el `testMatch` del config de humo de CI
// (`*.spec.ts`, solo `tests/e2e/`) no los toma.
//
// Proyectos:
//  - `desktop`: Chromium a 1280x900.
//  - `mobile`: Chromium a 390x844 táctil, con la posición simulada concedida.
// Corren de a uno (`workers: 1`): comparten las pocas cuentas fijas y los turnos de "hoy".
export default defineConfig({
  testDir: '.',
  globalSetup: '../fixtures/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 120_000,
  globalTimeout: 30 * 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: E2E_BASE_URL,
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
  },
  // Puerto 5173 por la lista blanca de CORS de la Edge Function `admin-users`.
  webServer: {
    command: 'pnpm exec vite preview --port 5173 --strictPort',
    cwd: APP_ROOT,
    url: E2E_BASE_URL,
    reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
    timeout: 30_000,
  },
  projects: [
    {
      name: 'desktop',
      testMatch: '**/*.desktop.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: 'mobile',
      testMatch: '**/*.movil.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        geolocation: POSICION_SIMULADA,
        permissions: ['geolocation'],
      },
    },
  ],
})
