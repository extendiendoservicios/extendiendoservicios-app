// tests/fixtures/movil-config.ts — TEST-017/TEST-018 (P18.2)
//
// Configuración común de las suites móviles (empleado y supervisor): los dos proyectos y el
// servidor del build local. Cada suite arma su `defineConfig` con esto y su `testMatch`.
//
// Proyectos:
//  - `mobile`: Chromium a 390x844 con pantalla táctil.
//  - `webkit`: WebKit con el perfil de iPhone 14 (viewport 390 px, táctil, agente de Safari). Va
//    DESPUÉS de `mobile` (`dependencies`): las dos corridas comparten las cuentas fijas y los
//    turnos de "hoy" de cada una, así que no pueden solaparse. Si `mobile` falla, `webkit` no
//    corre; para correrlo igual: `--project=webkit --no-deps`.

import { fileURLToPath } from 'node:url'
import { devices, type PlaywrightTestConfig } from '@playwright/test'
import { E2E_BASE_URL } from './env.ts'

// `vite preview` arranca con el directorio del config como `cwd` por omisión: hay que fijarlo
// a la raíz de `app/` para que encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

export function configMovil(testMatch: string): PlaywrightTestConfig {
  return {
    testDir: '.',
    testMatch,
    globalSetup: '../../fixtures/global-setup.ts',
    // Un archivo a la vez: las cuentas fijas de empleado y supervisor son pocas y los turnos de
    // "hoy" de una se ven en su pantalla Hoy; dos archivos en paralelo se pisarían.
    fullyParallel: false,
    workers: 1,
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
    // Puerto 5173 por la lista blanca de CORS de la Edge Function `admin-users`.
    webServer: {
      command: 'pnpm exec vite preview --port 5173 --strictPort',
      cwd: APP_ROOT,
      url: E2E_BASE_URL,
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
      {
        name: 'webkit',
        dependencies: ['mobile'],
        use: { ...devices['iPhone 14'] },
      },
    ],
  }
}
