// tests/fixtures/global-setup.ts — TEST-015/TEST-016 (P18.1)
//
// Global setup de Playwright para las suites de F18 contra `App_dev`:
//  1. Deja las cuentas fijas creadas, activas y completas (idempotente: `ensureFixedAccounts`).
//  2. Barre los residuos `e2e-` de una corrida anterior que se cortó a la mitad.
//  3. Inicia sesión una vez por cuenta y deja el `storageState` y los ids para los tests.
// Sin variables en `.env.local` no hace nada: los specs se saltean solos (`test.skip`).

import { readE2eEnv } from './env.ts'
import {
  ensureFixedAccounts,
  FIXED_ACCOUNT_LIST,
  loadAuthUserIds,
  getAdminDb,
  OWNER_EMAIL,
} from './accounts.ts'
import { sweepResidues } from './scenario.ts'
import {
  emailOf,
  signInSession,
  writeIds,
  writeStorageState,
  type SessionKey,
} from './sessions.ts'

export default async function globalSetup(): Promise<void> {
  if (!readE2eEnv()) return

  const db = getAdminDb()
  const ensured = await ensureFixedAccounts(db)
  if (ensured.created.length > 0) {
    console.log(`[fixtures] cuentas fijas creadas: ${ensured.created.length}`)
  }

  const swept = await sweepResidues(db)
  if (swept > 0)
    console.log(`[fixtures] residuos barridos: ${swept} cliente(s) e2e-`)

  const ownerId = (await loadAuthUserIds(db)).get(OWNER_EMAIL.toLowerCase())
  if (!ownerId) throw new Error('No existe el dueño del seed en App_dev.')
  writeIds({ ...ensured.ids, owner: ownerId })

  const keys: SessionKey[] = ['owner', ...FIXED_ACCOUNT_LIST.map((a) => a.key)]
  for (const key of keys) {
    let session
    try {
      session = await signInSession(emailOf(key))
    } catch {
      // Contraseña desfasada (por ejemplo, una corrida cortada a mitad de un test de reseteo):
      // se repone una vez en todas las cuentas y se reintenta.
      await ensureFixedAccounts(db, { forcePassword: true })
      session = await signInSession(emailOf(key))
    }
    writeStorageState(key, session)
  }
}
