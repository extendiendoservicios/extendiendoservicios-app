import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_BASE_URL } from '../../fixtures/env.ts'

// `vite preview` arranca con el directorio de este archivo como `cwd` por omisión, no la raíz de
// `app/`: hay que fijarlo a mano para que encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

// TEST-016 (P18.1, F18): suite e2e "administración" contra un backend real (App_dev) con el
// juego de cuentas fijas de `tests/fixtures/`.
//
// Por qué está acá y no la descubre `playwright.config.ts` (la suite de humo de CI): los archivos
// terminan en `.admin.ts`, no en `.spec.ts`, así que el `testMatch` por omisión del config
// principal NO los toma (ese config corre en CI con un build de variables FALSAS y como smoke
// test de los despliegues, y no puede depender de ningún dato real). Este config los toma con su
// propio `testMatch`.
//
// Proyectos:
//  - `chromium`: escritorio 1280x900; todos los archivos salvo los `*.movil.admin.ts`.
//  - `mobile`: 390x844 táctil; solo los `*.movil.admin.ts` (administración desde el celular).
//
// Puerto 5173 por la lista blanca de CORS de la Edge Function `admin-users`.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.admin.ts',
  globalSetup: '../../fixtures/global-setup.ts',
  // Un archivo por proceso en paralelo; dentro de un archivo, en orden. Cada archivo usa sus
  // propias cuentas fijas de empleado para no pisarse (ver el encabezado de cada uno).
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: E2E_BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 5173 --strictPort',
    cwd: APP_ROOT,
    url: E2E_BASE_URL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: ['**/*.movil.admin.ts', '**/recorrido-dueno.admin.ts'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      // El recorrido del dueño termina cerrando la sesión del dueño del seed y esa cuenta es
      // única: va DESPUÉS del resto para que el cierre no deje sin sesión a los tests que
      // comparten el `storageState` del dueño.
      name: 'dueno-final',
      testMatch: '**/recorrido-dueno.admin.ts',
      dependencies: ['chromium', 'mobile'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: 'mobile',
      testMatch: '**/*.movil.admin.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
})
