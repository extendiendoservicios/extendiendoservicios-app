import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_SUPERVISIONES_BASE_URL } from './helpers/baseUrl.ts'

// Mismo motivo que el resto de las suites de backend real: Playwright arranca
// `webServer.command` con el directorio de este archivo como `cwd` por omisión, no la raíz de
// `app/` — hay que fijarlo a mano para que `vite preview` encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// SUP-013/MOB-SUP-013/TEST-013 (P15.6, 08_Fases_y_Backlog.md F15): e2e de supervisiones contra
// un backend real (App_dev). Dos proyectos:
// - `desktop`: escritorio ≥1024 px, para SUP-013 (administración: asignar, detalle, no
//   realizada, cancelar, editar calificación -- el drawer de 452 px de ADM-14/ADM-15 solo
//   aparece a partir de esa medida, `05` sección 7).
// - `mobile`: 390×844, para MOB-SUP-013 (la app del supervisor, DS-015/MOB-SUP-016 -- sin
//   variante de escritorio).
//
// `pnpm test:e2e:supervisiones` (a falta de un script en package.json, ver el reporte de esta
// tarea) corre `pnpm build` primero (carga `.env.local` con la convención de Vite, así apunta de
// verdad a `App_dev`) y recién después Playwright, que sirve ese `dist/` con
// `vite preview --port 4178`.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // datos descartables por test, sin necesidad de paralelismo acá.
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 120_000,
  use: {
    baseURL: E2E_SUPERVISIONES_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 4178',
    cwd: APP_ROOT,
    url: E2E_SUPERVISIONES_BASE_URL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'desktop',
      testMatch: '**/admin-*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: '**/mobile-*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
})
