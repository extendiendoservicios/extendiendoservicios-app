import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Prueba de integración del importador contra App_dev (DATA-005). Igual que la suite de
// permisos, queda FUERA de `pnpm test`: los archivos terminan en `.integracion.ts`, que el
// patrón por defecto de Vitest (`**/*.{test,spec}.*`) no ve. Se corre a mano con
// `pnpm test:import` (lee `app/.env.local`; el destino es siempre App_dev).
//
// Los datos son ficticios y llevan el prefijo `imp-test-`; la prueba los barre al terminar (y al
// empezar, por si una corrida anterior se cortó) sin tocar nada que no lo tenga. No correr
// mientras corre el nocturno de e2e (4:30), que usa App_dev.
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    environment: 'node',
    include: [
      'scripts/import-initial/**/*.integracion.ts',
      'scripts/entregar-credenciales/**/*.integracion.ts',
    ],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
})
