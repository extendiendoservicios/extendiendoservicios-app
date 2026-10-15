import './conjunto.ts'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_BASE_URL } from '../fixtures/env.ts'

// `vite preview` arranca con el directorio del config como `cwd` por omisión: hay que fijarlo a la
// raíz de la app para que encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PUERTO = new URL(E2E_BASE_URL).port || '5173'

// P22.5 (módulo B1): e2e de la geolocalización y la corrección de fichajes contra `App_dev`.
// Los archivos terminan en `.movil.ts` (celular a 390 px, geolocalización simulada por cada test) o
// `.desktop.ts` (administración a 1280 px); el `testMatch` del config de humo de CI (`*.spec.ts`,
// solo `tests/e2e/`) no los toma.
//
// Proyectos:
//  - `mobile`: Chromium a 390x844 táctil, con el permiso de ubicación concedido (cada test fija la
//    posición con `context.setGeolocation`; los que prueban «sin permiso» lo quitan).
//  - `desktop`: Chromium a 1280x900.
//  - `webkit-movil`: WebKit con el perfil de iPhone 14, solo los `*.movil.ts` (va después de `mobile`
//    porque comparten las cuentas y los turnos de «hoy»).
// Corren de a uno (`workers: 1`): comparten las pocas cuentas fijas y los turnos de «hoy».
export default defineConfig({
  testDir: '.',
  globalSetup: '../fixtures/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 120_000,
  globalTimeout: 40 * 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: E2E_BASE_URL,
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
  },
  webServer: {
    command: `pnpm exec vite preview --port ${PUERTO} --strictPort`,
    cwd: APP_ROOT,
    url: E2E_BASE_URL,
    // `E2E_REUSE_SERVER=1`: usa el `vite preview` ya levantado en ese puerto.
    reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
    timeout: 30_000,
  },
  projects: [
    {
      name: 'mobile',
      testMatch: '**/*.movil.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        permissions: ['geolocation'],
      },
    },
    {
      name: 'desktop',
      testMatch: '**/*.desktop.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: 'webkit-movil',
      testMatch: '**/*.movil.ts',
      dependencies: ['mobile'],
      use: { ...devices['iPhone 14'], permissions: ['geolocation'] },
    },
  ],
})
