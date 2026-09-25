// tests/e2e-shifts-services/permissions-interface.spec.ts — SHIFT-012/TEST-007 (P10.4,
// 08_Fases_y_Backlog.md F10)
//
// Permisos por capacidad en la interfaz (encargo P10.4, punto 2): "un administrador sin
// generate_shifts no puede generar" y "un administrador sin cancel_shifts no ve 'Cancelar'".
// Mismo patrón que `tests/e2e-users/owner-creates-admin-and-capabilities.spec.ts`: el dueño crea
// un administrador descartable desde ADM-27, le saca las dos capacidades, ese administrador
// entra y se comprueba qué ve. `06_API.md` sección 6/7 y `src/features/shifts/permissions.ts`
// (`canGenerateShifts`, `canCancelShift`).

import { expect, test } from '@playwright/test'
import { readE2eShiftsServicesEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  cleanupDisposableClient,
  createDisposableClient,
  createDisposableShift,
  createDisposableSite,
  getAdminClient,
} from './helpers/adminClient.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

const env = readE2eShiftsServicesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('SHIFT-012: permisos por capacidad en la interfaz (generate_shifts, cancel_shifts)', () => {
  test('un administrador sin generate_shifts no puede generar, y sin cancel_shifts no debería ver "Cancelar"', async ({
    page,
    browser,
  }, testInfo) => {
    testInfo.setTimeout(120_000)

    const admin = getAdminClient()
    const client = await createDisposableClient(admin, 'Cliente-Permisos')
    const site = await createDisposableSite(admin, client.id, 'Sede-Permisos')
    // Turno de fixture cancelable, en el mes lejano reservado -- insertado directo (no hace
    // falta generate_shifts para esto, ver createDisposableShift).
    const fixtureDate = '2190-06-01'
    const fixtureShift = await createDisposableShift(
      admin,
      client.id,
      site.id,
      fixtureDate,
    )

    const email = `e2e-p104-admin-${Date.now()}@example.com`
    const password = `${env!.seedPassword}Aa1`
    const lastName = `P104 Admin Permisos ${Date.now()}`
    const fullName = `E2E ${lastName}`
    let newAdminProfileId: string | null = null

    try {
      await test.step('el dueño crea un administrador descartable y le saca generate_shifts y cancel_shifts', async () => {
        await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
        await page.goto('/admin/configuracion/usuarios')
        await page.getByRole('button', { name: 'Nuevo administrador' }).click()
        await page.getByLabel('Nombre').fill('E2E')
        await page.getByLabel('Apellido').fill(lastName)
        await page.getByLabel('Email de login').fill(email)
        await page.getByLabel('Contraseña inicial').fill(password)
        await page.getByRole('button', { name: 'Crear administrador' }).click()
        await expect(
          page.getByText(`Creamos la cuenta de ${fullName}.`),
        ).toBeVisible()

        const { data: usersList, error } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        })
        if (error) throw error
        const created = usersList.users.find((u) => u.email === email)
        expect(
          created,
          `no encontramos la cuenta recién creada (${email})`,
        ).toBeTruthy()
        newAdminProfileId = created!.id

        await page
          .getByRole('button', { name: `Acciones para ${fullName}` })
          .click()
        await page
          .getByRole('menuitem', { name: 'Editar roles y capacidades' })
          .click()
        await expect(page.getByRole('switch').first()).toBeVisible()
        await page
          .getByRole('switch', { name: /Generar turnos del mes/i })
          .click()
        await page.getByRole('switch', { name: /Cancelar turnos/i }).click()
        await expect(
          page.getByRole('switch', { name: /Generar turnos del mes/i }),
        ).not.toBeChecked()
        await expect(
          page.getByRole('switch', { name: /Cancelar turnos/i }),
        ).not.toBeChecked()
        await page.getByRole('button', { name: 'Cerrar' }).first().click()
      })

      const newAdminContext = await browser.newContext()
      const newAdminPage = await newAdminContext.newPage()
      try {
        await test.step('ADM-09: sin generate_shifts, no puede generar (EmptyState)', async () => {
          await loginAs(newAdminPage, email, password, /\/admin$/)
          await newAdminPage.goto('/admin/turnos/generar')
          await expect(
            newAdminPage.getByText('No tenés permiso para generar turnos'),
          ).toBeVisible()
          await expect(
            newAdminPage.getByRole('button', {
              name: 'Generar turnos del mes',
            }),
          ).toHaveCount(0)
        })

        await test.step('ADM-05: sin cancel_shifts, no debería ver "Cancelar" sobre un turno programado (06_API.md sección 7: cancel_shift, capacidad cancel_shifts)', async () => {
          await newAdminPage.goto(
            `/admin/planificacion?vista=dia&fecha=${fixtureDate}`,
          )
          const row = newAdminPage.locator('tr', { hasText: site.name })
          await expect(row).toBeVisible()
          // Expectativa según el plan: un administrador con canManageShiftTime (cualquier
          // administrador, para "Editar") pero SIN cancel_shifts no debería ver "Cancelar" sobre
          // un turno que sí se puede cancelar. `ShiftsDayList.tsx` hoy decide mostrar "Cancelar"
          // con el mismo `canManage` que decide "Editar" (`canManageShiftTime`), sin usar
          // `canCancelShift` (que sí existe en `src/features/shifts/permissions.ts` y sí lo
          // exige del lado del servidor) -- ver el defecto reportado al orquestador.
          // `expect.soft`: se espera que ESTA aserción falle mientras el defecto siga sin
          // corregirse (documentado en el reporte del encargo) -- se usa `soft` para que el
          // resto del test (la comprobación del lado del servidor) siga corriendo y quede
          // registrada igual, en vez de cortar acá.
          expect
            .soft(await row.getByRole('button', { name: 'Cancelar' }).count())
            .toBe(0)
        })

        await test.step('por las dudas, el servidor igual rechaza cancel_shift aunque el botón estuviera visible', async () => {
          // Se prueba directo por API con supabase-js autenticado como la cuenta nueva (no con
          // el `request` context de Playwright): más simple para llamar una RPC de Postgres con
          // el token de esta sesión en particular.
          const { createClient } = await import('@supabase/supabase-js')
          const anon = createClient(env!.supabaseUrl, env!.anonKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          })
          const { error: signInError } = await anon.auth.signInWithPassword({
            email,
            password,
          })
          expect(signInError).toBeNull()
          const { error: rpcError } = await anon.rpc('cancel_shift', {
            p_shift_id: fixtureShift.id,
            p_reason: 'e2e-p104: no debería poder',
          })
          expect(rpcError?.hint ?? rpcError?.message).toMatch(/FORBIDDEN/i)
          await anon.auth.signOut()
        })
      } finally {
        await newAdminContext.close()
      }
    } finally {
      await cleanupDisposableClient(admin, client.id, [])
      if (newAdminProfileId) {
        await admin.auth.admin.updateUserById(newAdminProfileId, {
          ban_duration: '876000h',
        })
        await admin
          .from('profiles')
          .update({ is_active: false, deleted_at: new Date().toISOString() })
          .eq('id', newAdminProfileId)
      }
    }
  })
})
