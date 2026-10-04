// tests/fixtures/setup-accounts.ts — TEST-015/TEST-016 (P18.1), TEST-021 (P18.4)
//
// Script idempotente: deja creado el juego de cuentas fijas de prueba en `App_dev` (activas, con
// su rol y su perfil de empleado o supervisor, con la contraseña de `SEED_DEV_PASSWORD`).
// Correrlo dos veces seguidas no crea nada nuevo. Crea TODOS los conjuntos de cuentas
// (`CONJUNTOS` en `accounts.ts`: uno por suite que corre en paralelo en CI). Uso, desde `app/`:
//   node --env-file=.env.local tests/fixtures/setup-accounts.ts
//
// Opciones:
//   --forzar-contrasena   repone la contraseña de todas (cierra las sesiones abiertas de esas cuentas).
//   --conjunto <nombre>   solo ese conjunto (por omisión, todos).
//   --barrer              además barre los residuos `e2e-` de corridas cortadas. Es el "barrido único"
//                         del workflow nocturno: las suites corren después con `E2E_SKIP_SWEEP=1`.

import { MISSING_ENV_MESSAGE, readE2eEnv } from './env.ts'
import { CONJUNTOS, ensureFixedAccounts, type Conjunto } from './accounts.ts'
import { sweepResidues } from './scenario.ts'

if (!readE2eEnv()) {
  console.error(MISSING_ENV_MESSAGE)
  process.exit(1)
}

const args = process.argv.slice(2)
const forcePassword = args.includes('--forzar-contrasena')
const idx = args.indexOf('--conjunto')
const pedido = idx >= 0 ? args[idx + 1] : undefined
if (pedido && !(CONJUNTOS as readonly string[]).includes(pedido)) {
  console.error(
    `Conjunto desconocido "${pedido}". Válidos: ${CONJUNTOS.join(', ')}`,
  )
  process.exit(1)
}
const conjuntos: readonly Conjunto[] = pedido ? [pedido as Conjunto] : CONJUNTOS

for (const conjunto of conjuntos) {
  const result = await ensureFixedAccounts(undefined, {
    forcePassword,
    conjunto,
  })
  console.log(
    `[${conjunto}] creadas ahora: ${result.created.length}; ya existían (repuestas): ${result.existing.length}`,
  )
  for (const email of result.created) console.log(`  + ${email}`)
}

if (args.includes('--barrer')) {
  const barridos = await sweepResidues()
  console.log(`Residuos barridos: ${barridos} cliente(s) e2e-`)
}
