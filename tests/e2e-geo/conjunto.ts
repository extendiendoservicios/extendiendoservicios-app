// tests/e2e-geo/conjunto.ts — P22.5
//
// Efecto de importación: fija el conjunto de cuentas `geo` si nadie lo pidió. Tiene que importarse
// ANTES que cualquier archivo que lea `tests/fixtures/accounts.ts` (que decide el conjunto activo al
// cargarse): por eso es la primera línea de `playwright.geo.config.ts`.
process.env.E2E_CONJUNTO ||= 'geo'
