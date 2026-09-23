import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { E2E_AUTH_BASE_URL } from './helpers/baseUrl.ts'

// Playwright arranca `webServer.command` con el directorio de este archivo como `cwd` por
// omisión (`tests/e2e-auth/`), no la raíz de `app/` — a diferencia de `pnpm exec`/`pnpm run`,
// que sí saltan al directorio del `package.json` más cercano. Sin este `cwd` explícito,
// `vite preview` buscaba `./dist` dentro de `tests/e2e-auth/` y fallaba con "The directory
// 'dist' does not exist" aunque el build de `app/dist` hubiera terminado bien (comprobado en
// P06.4: el build mostraba "✓ built in 2.40s" y el error de `vite preview` aparecía igual)
// — no una carrera entre build y preview, sino el directorio equivocado.
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// AUTH-012/TEST-003 (P06.4, 08_Fases_y_Backlog.md F6): e2e de autenticación contra un backend
// real (App_dev), separados a propósito de `tests/e2e/` (`../../playwright.config.ts`).
//
// Por qué un config aparte y no sumar estos specs a `tests/e2e/`: `tests/e2e/` la corren
// `ci.yml` (contra el build con variables FALSAS, sin backend) y `deploy-staging.yml` /
// `deploy-production.yml` (como smoke test contra la URL ya publicada). Ninguno de los tres
// tiene las credenciales de servicio que esta suite necesita para crear y borrar cuentas
// descartables, y no correspondería que las tuviera: son workflows de humo/despliegue, no la
// suite de autenticación. Al vivir en `tests/e2e-auth/` con su propio `testDir` y su propio
// script (`pnpm test:e2e:auth`, `package.json`), ninguno de esos tres workflows la descubre ni
// la ejecuta — se corre a mano, desde la máquina de quien tiene `.env.local`.
//
// El build que sirve `vite preview` acá SÍ tiene que apuntar a `App_dev` de verdad ("Objetivo
// por defecto: el build local (pnpm build + pnpm preview) apuntando a App_dev", regla 7 del
// encargo): `pnpm test:e2e:auth` (`package.json`) corre `pnpm build` primero (carga
// `.env.local` con la convención de Vite) y recién después esta suite — ver
// `tests/e2e-auth/README.md`.
//
// Puerto 4174 (no 4173, el de `tests/e2e/`): así se puede tener las dos suites levantadas al
// mismo tiempo sin choque, aunque en la práctica se corren una por vez.

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // cuentas descartables por test: sin necesidad de paralelismo acá.
  retries: 0,
  reporter: 'html',
  timeout: 30_000,
  use: {
    baseURL: E2E_AUTH_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 4174',
    cwd: APP_ROOT,
    url: E2E_AUTH_BASE_URL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
})
