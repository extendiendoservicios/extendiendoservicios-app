// tests/fixtures/setup-accounts.ts — TEST-015/TEST-016 (P18.1)
//
// Script idempotente: deja creado el juego de cuentas fijas de prueba en `App_dev` (activas, con
// su rol y su perfil de empleado o supervisor, con la contraseña de `SEED_DEV_PASSWORD`).
// Correrlo dos veces seguidas no crea nada nuevo. Uso, desde `app/`:
//   node --env-file=.env.local tests/fixtures/setup-accounts.ts

import { MISSING_ENV_MESSAGE, readE2eEnv } from './env.ts'
import { ensureFixedAccounts } from './accounts.ts'

if (!readE2eEnv()) {
  console.error(MISSING_ENV_MESSAGE)
  process.exit(1)
}

// `--forzar-contrasena` repone la contraseña de todas (cierra las sesiones abiertas de esas cuentas).
const result = await ensureFixedAccounts(undefined, {
  forcePassword: process.argv.includes('--forzar-contrasena'),
})
console.log(`Cuentas fijas creadas ahora: ${result.created.length}`)
for (const email of result.created) console.log(`  + ${email}`)
console.log(
  `Cuentas fijas que ya existían (repuestas): ${result.existing.length}`,
)
for (const email of result.existing) console.log(`  = ${email}`)
