import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_RESPONSIVE_BASE_URL } from './helpers/baseUrl.ts'

// Mismo motivo que el resto de las suites de backend real: Playwright arranca
// `webServer.command` con el directorio de este archivo como `cwd` por omisión, no la raíz de
// `app/` -- hay que fijarlo a mano para que `vite preview` encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// RESP-003/RESP-005/RESP-006/RESP-007 (P17.2, 08_Fases_y_Backlog.md F17): revisión responsive de
// las pantallas de administración, y pasada rápida de empleado y supervisor, contra un backend
// real (App_dev). Un solo proyecto: cada test fija su propio ancho de ventana con
// `page.setViewportSize` (390, 768, 1024, 1366 y 1440 px), porque lo que se prueba es justamente
// el cambio de comportamiento entre anchos sobre los mismos datos.
//
// `outputDir` propio: las capturas viven en `test-results/responsive-capturas/` (carpeta ya
// ignorada por git con `/test-results/`) y NO en el `outputDir` de Playwright, que se vacía en
// cada corrida.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  globalSetup: './globalSetup.ts',
  fullyParallel: false, // datos descartables por archivo y un solo puerto.
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 180_000,
  outputDir: '../../test-results/responsive-run',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: E2E_RESPONSIVE_BASE_URL,
    trace: 'off',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 5173',
    cwd: APP_ROOT,
    url: E2E_RESPONSIVE_BASE_URL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [{ name: 'responsive' }],
})
