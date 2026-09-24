import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_CLIENTS_SITES_BASE_URL } from './helpers/baseUrl.ts'

// Mismo motivo que `tests/e2e-auth/` y `tests/e2e-users/`: Playwright arranca
// `webServer.command` con el directorio de este archivo como `cwd` por omisión
// (`tests/e2e-clients-sites/`), no la raíz de `app/` — hay que fijarlo a mano para que
// `vite preview` encuentre `./dist`.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// CLIENT-008/SITE-008/TEST-005 (P08.5, 08_Fases_y_Backlog.md F8): e2e de clientes y sedes
// contra un backend real (App_dev), en su propia carpeta por el mismo motivo que
// `tests/e2e-auth/` y `tests/e2e-users/` (ver sus comentarios largos): necesita
// `SUPABASE_SERVICE_ROLE_KEY` para preparar y borrar clientes, contactos y sedes descartables,
// algo que ni `ci.yml` ni los workflows de despliegue tienen ni deberían tener. No se agregó a
// `tests/e2e-users/` porque el dominio es otro (clientes y sedes, no usuarios) y porque esta
// suite no llama a ninguna Edge Function (todo el dominio es insert/update directo por
// PostgREST, `06_API.md` secciones 4 y 5) — no tiene la restricción de puerto por CORS que
// obliga a `tests/e2e-users/` a usar 5173.
//
// `pnpm test:e2e:clients-sites` corre `pnpm build` primero (carga `.env.local` con la
// convención de Vite, así apunta de verdad a `App_dev`) y recién después Playwright, que sirve
// ese `dist/` con `vite preview --port 4175`.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // datos descartables por test, sin necesidad de paralelismo acá.
  workers: 1,
  retries: 0,
  reporter: 'html',
  timeout: 60_000,
  use: {
    baseURL: E2E_CLIENTS_SITES_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 4175',
    cwd: APP_ROOT,
    url: E2E_CLIENTS_SITES_BASE_URL,
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
      // Igual que `tests/e2e-users/`: solo las capturas móviles de TEST-005 corren también a
      // 390 px. El resto de los specs de esta carpeta son recorridos de escritorio (1280 px) sin
      // nada nuevo que ver en otro ancho -- correrlos dos veces solo duplicaría escrituras en
      // App_dev sin agregar cobertura.
      testMatch: '**/mobile-screenshots.spec.ts',
    },
  ],
})
