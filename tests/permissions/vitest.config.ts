import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Config dedicado de la suite de permisos (P04.7, 08_Fases_y_Backlog.md F4).
//
// A propósito NO es el `vitest.config.ts` de la raíz: ese lo corre `pnpm test` en cada PR
// (ci.yml), donde no existe `.env.local` ni hay credenciales de `App_dev` (regla del encargo:
// "los tests nuevos no pueden romper el CI"). Esta suite queda fuera de esa corrida por
// construcción, no por una condición en tiempo de ejecución: los archivos de
// `tests/permissions/` usan la extensión `.permissions.ts` (no `.test.ts` ni `.spec.ts`), así
// que ni siquiera coinciden con el patrón por defecto de Vitest (`**/*.{test,spec}.*`) que usa
// el config de la raíz -- `pnpm test` no los ve. Además, cada spec se saltea solo con un aviso
// si faltan las variables de entorno (`describe.skipIf`, ver helpers/env.ts): doble capa de
// seguridad para que nunca rompa CI, aunque alguien lo corra con este config sin `.env.local`.
//
// Se corre a mano, desde `app/`, con `.env.local` cargado:
//   node --env-file=.env.local ./node_modules/.bin/vitest run --config tests/permissions/vitest.config.ts
// (ver tests/permissions/README.md).
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    environment: 'node',
    include: ['tests/permissions/**/*.permissions.ts'],
    // Contra una base real (App_dev), no localhost: sin retries ni mocks -- si algo tarda, es
    // señal real (RLS mal escrita, red), no un timeout por defecto demasiado corto.
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
})
