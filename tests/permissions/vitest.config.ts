import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Config de la matriz de permisos completa (TEST-019, P18.3, 08_Fases_y_Backlog.md F18).
//
// Igual que la suite que nació en P04.7, queda FUERA de `pnpm test` (el de la raíz, que corre en
// cada PR sin credenciales): los archivos terminan en `.permissions.ts`, que el patrón por
// defecto de Vitest (`**/*.{test,spec}.*`) no ve. Se corre a mano o en el workflow nocturno con
// `pnpm test:permissions` (lee `app/.env.local`, apunta a App_dev).
//
// Los archivos corren UNO DETRÁS DE OTRO (`fileParallelism: false`): comparten las diez cuentas
// fijas y el escenario plantado, y la prueba de desactivados cambia el estado de tres cuentas.
// Tampoco se puede correr en paralelo con las suites e2e, que usan las mismas cuentas.
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    environment: 'node',
    include: ['tests/permissions/suite/**/*.permissions.ts'],
    globalSetup: ['tests/permissions/suite/global-setup.ts'],
    fileParallelism: false,
    // Contra una base real: sin reintentos ni mocks. Si algo tarda es una señal real.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
})
