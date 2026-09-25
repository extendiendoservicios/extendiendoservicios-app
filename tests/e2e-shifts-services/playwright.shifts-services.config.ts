import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_SHIFTS_SERVICES_BASE_URL } from './helpers/baseUrl.ts'

// Mismo motivo que el resto de las suites de backend real (`tests/e2e-auth/`,
// `tests/e2e-users/`, `tests/e2e-clients-sites/`, `tests/e2e-employees/`, ver sus propios
// comentarios largos): Playwright arranca `webServer.command` con el directorio de este archivo
// como `cwd` por omisión, no la raíz de `app/` — hay que fijarlo a mano para que `vite preview`
// encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// SERVICE-007/SHIFT-012/TEST-007 (P10.4, 08_Fases_y_Backlog.md F10): e2e de servicios y turnos
// contra un backend real (App_dev), en su propia carpeta por el mismo motivo que las otras
// suites de backend real: necesita `SUPABASE_SERVICE_ROLE_KEY` para preparar y limpiar clientes,
// sedes, servicios y feriados descartables, y para crear un administrador descartable en los
// casos de permisos por capacidad (Edge Function `admin-users`, de ahí el puerto 5173).
//
// `pnpm test:e2e:shifts-services` corre `pnpm build` primero (carga `.env.local` con la
// convención de Vite, así apunta de verdad a `App_dev`) y recién después Playwright, que sirve
// ese `dist/` con `vite preview --port 5173`.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // datos descartables por test, sin necesidad de paralelismo acá.
  workers: 1,
  retries: 0,
  reporter: 'html',
  // Recorridos largos contra un backend real, con navegación de calendario por teclado
  // (`helpers/datePicker.ts`) y clics de año en `helpers/monthPicker.ts` (~164 desde 2026 hasta
  // el mes lejano reservado, `helpers/farDate.ts`): el timeout por omisión de Playwright (30 s)
  // no alcanza para los specs que generan el mes lejano.
  timeout: 120_000,
  use: {
    baseURL: E2E_SHIFTS_SERVICES_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 5173',
    cwd: APP_ROOT,
    url: E2E_SHIFTS_SERVICES_BASE_URL,
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
  ],
})
