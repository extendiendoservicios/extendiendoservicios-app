// tests/permissions/fixtures/seed-accounts.ts — P04.7
//
// Emails de las 14 cuentas ficticias del seed de `App_dev` (supabase/seed.sql,
// scripts/seed-dev.ts), agrupadas por rol. Todas comparten `SEED_DEV_PASSWORD`
// (docs/environments.md sección 4). Nunca se guardan uuids acá: cada spec resuelve el `id` que
// necesita en tiempo de ejecución (`loginAs` o `resolveUserId`), porque el seed es idempotente
// pero no promete los mismos ids entre corridas de `pnpm db:seed`.

export const SEED_ACCOUNTS = {
  owner: 'extserviciosapp@gmail.com',
  admin: 'andrea.rios@extendiendoservicios.com',
  supervisors: [
    'paula.lemos@extendiendoservicios.com',
    'noelia.vera@extendiendoservicios.com',
  ],
  employees: [
    'maria.gomez@extendiendoservicios.com',
    'juan.perez@extendiendoservicios.com',
    'sofia.ruiz@extendiendoservicios.com',
    'carlos.medina@extendiendoservicios.com',
    'lucia.torres@extendiendoservicios.com',
    'rocio.aguirre@extendiendoservicios.com',
    'valeria.paz@extendiendoservicios.com',
    'diego.fabbri@extendiendoservicios.com',
    'martin.sosa@extendiendoservicios.com',
    'patricia.nunez@extendiendoservicios.com',
  ],
} as const
