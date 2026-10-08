// tests/e2e-ajustes-reunion/conjunto.ts — P19.5d
//
// Efecto de importación: fija el conjunto de cuentas `ajustes` si nadie lo pidió. Tiene que
// importarse ANTES que cualquier archivo que lea `tests/fixtures/accounts.ts` (que decide el
// conjunto activo al cargarse): por eso es la primera línea de `playwright.ajustes.config.ts`. Así
// `pnpm test:e2e:ajustes-reunion` funciona en Windows sin pasar variables de entorno a mano.
process.env.E2E_CONJUNTO ||= 'ajustes'
