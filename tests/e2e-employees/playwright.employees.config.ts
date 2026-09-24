import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_EMPLOYEES_BASE_URL } from './helpers/baseUrl.ts'

// Mismo motivo que `tests/e2e-auth/`, `tests/e2e-users/` y `tests/e2e-clients-sites/`:
// Playwright arranca `webServer.command` con el directorio de este archivo como `cwd` por
// omisión (`tests/e2e-employees/`), no la raíz de `app/` — hay que fijarlo a mano para que
// `vite preview` encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// EMP-014/TEST-006 (P09.5, 08_Fases_y_Backlog.md F9): e2e de empleados y supervisores contra un
// backend real (App_dev), en su propia carpeta por el mismo motivo que las otras suites de
// backend real (ver sus propios README): necesita `SUPABASE_SERVICE_ROLE_KEY` para limpiar todo
// lo que crea sin pasar por la interfaz ni gastar el límite de 10 acciones por minuto del dueño.
//
// Puerto 5173 (no uno propio): ver el comentario largo de `helpers/baseUrl.ts` -- lo exige la
// lista blanca de CORS de la Edge Function `admin-users`, que esta suite sí invoca desde el
// navegador (alta de empleado y supervisor "con usuario", ADM-18).
//
// `pnpm test:e2e:employees` corre `pnpm build` primero (carga `.env.local` con la convención de
// Vite, así apunta de verdad a `App_dev`) y recién después Playwright, que sirve ese `dist/` con
// `vite preview --port 5173`.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // datos descartables por test, sin necesidad de paralelismo acá.
  workers: 1,
  retries: 0,
  reporter: 'html',
  timeout: 60_000,
  use: {
    baseURL: E2E_EMPLOYEES_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 5173',
    cwd: APP_ROOT,
    url: E2E_EMPLOYEES_BASE_URL,
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
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
      // Igual que `tests/e2e-clients-sites/`: solo las capturas móviles de TEST-006 corren
      // también a 390 px. El resto de los specs de esta carpeta son recorridos de escritorio
      // (1280 px) sin nada nuevo que ver en otro ancho.
      testMatch: '**/mobile-screenshots.spec.ts',
    },
  ],
})
