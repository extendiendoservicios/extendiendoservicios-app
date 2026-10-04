import { expect, test } from '@playwright/test'
import {
  ensureFixedAccounts,
  esDelConjuntoActivo,
  FIXED_ACCOUNT_LIST,
  FIXED_ACCOUNTS,
  getAdminDb,
  type FixedAccountKey,
} from '../../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { loginByForm } from '../../fixtures/ui.ts'

// TEST-015/TEST-016 (P18.1): las cuentas fijas de prueba que usan todas las suites de F18.
// Decisión de Mike del 3 oct 2026: un juego estable de cuentas por rol en vez de cuentas nuevas
// en cada corrida (nada se borra físicamente, P-014). Rastreo: RB-A01, RB-E01, RB-S01 (ingreso).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

// Estos tests no usan sesión previa: prueban el ingreso por la pantalla.
test.use({ storageState: { cookies: [], origins: [] } })

async function countFixedAuthUsers(): Promise<number> {
  const db = getAdminDb()
  let total = 0
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (error) throw new Error(error.message)
    total += data.users.filter(
      (u) => u.email && esDelConjuntoActivo(u.email),
    ).length
    if (data.users.length < 1000) break
  }
  return total
}

test.describe('cuentas fijas de prueba (RB-A01, RB-E01, RB-S01)', () => {
  test('el setup es idempotente: correrlo de nuevo no crea cuentas y las deja completas', async () => {
    const before = await countFixedAuthUsers()
    expect(before).toBe(FIXED_ACCOUNT_LIST.length)

    // `restore: false`: esta llamada ocurre en medio de la corrida, con otros archivos en paralelo;
    // no puede cambiar contraseñas (cierra sesiones) ni pisar capacidades.
    const result = await ensureFixedAccounts(undefined, { restore: false })
    expect(
      result.created,
      'una segunda corrida no tiene que crear nada',
    ).toEqual([])
    expect(result.existing).toHaveLength(FIXED_ACCOUNT_LIST.length)
    expect(await countFixedAuthUsers()).toBe(before)

    // Cada cuenta: perfil activo, exactamente sus roles y, si corresponde, ficha activa.
    const db = getAdminDb()
    for (const spec of FIXED_ACCOUNT_LIST) {
      const id = result.ids[spec.key]
      const { data: profile } = await db
        .from('profiles')
        .select('is_active, deleted_at, first_name, last_name')
        .eq('id', id)
        .single()
      expect(profile?.is_active, `${spec.email} activa`).toBe(true)
      expect(profile?.deleted_at).toBeNull()

      const { data: roles } = await db
        .from('user_roles')
        .select('role')
        .eq('profile_id', id)
      expect(roles?.map((r) => r.role).sort(), `${spec.email} roles`).toEqual(
        [...spec.roles].sort(),
      )

      if (spec.dni) {
        const { data: employee } = await db
          .from('employees')
          .select('status, dni')
          .eq('profile_id', id)
          .single()
        expect(employee?.status, `${spec.email} ficha`).toBe('active')
        expect(employee?.dni).toBe(spec.dni)
      }
      if (spec.roles.includes('admin')) {
        // Solo la cantidad de filas: el estado de cada capacidad lo mueven otros tests.
        const { data: caps } = await db
          .from('admin_capabilities')
          .select('capability')
          .eq('profile_id', id)
        expect(caps, `${spec.email} capacidades`).toHaveLength(7)
      }
    }
  })

  const ingresos: Array<{ key: FixedAccountKey; home: RegExp }> = [
    { key: 'admin', home: /\/admin$/ },
    { key: 'empleado1', home: /\/app$/ },
    { key: 'supervisor1', home: /\/sup$/ },
  ]
  for (const { key, home } of ingresos) {
    test(`la cuenta fija ${key} ingresa por la pantalla y cae en su inicio`, async ({
      page,
    }) => {
      await loginByForm(page, FIXED_ACCOUNTS[key].email, home)
    })
  }
})
