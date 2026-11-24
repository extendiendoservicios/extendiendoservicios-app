// tests/e2e-p31/conjunto.ts — P31.6
//
// Efecto de importación: fija el conjunto de cuentas `ajustes` si nadie lo pidió (administración,
// cuatro empleados, un coordinador y el doble rol; el dueño del seed es común a todos). Tiene que
// importarse ANTES que cualquier archivo que lea `tests/fixtures/accounts.ts`: por eso es la
// primera línea de `playwright.p31.config.ts`.
process.env.E2E_CONJUNTO ||= 'ajustes'
