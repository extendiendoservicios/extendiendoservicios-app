// tests/e2e-assignments/mobile-day-list-assign.spec.ts — ASSIGN-015 punto 4 (P11.4,
// 08_Fases_y_Backlog.md F11, criterio de aceptación: "asignar desde la lista del día en
// viewport de celular")
//
// A 390 px, `ShiftsDayList` (ADM-05) se ve en modo tarjeta (`DataTable`/`RowCard`, no hay una
// pantalla de asignación aparte para celular): el criterio se cumple entrando por "Ver" a
// `/admin/turnos/:id` (ADM-06), que a menos de 1024 px es página completa (no drawer,
// `ShiftDetailPage.tsx`) y desde ahí "Asignar empleado" abre la hoja de ADM-08, que
// `components/ui/sheet.tsx` autoajusta a pantalla completa por debajo de 768 px. Corre en el
// proyecto `mobile` (390 px, geolocalización concedida — `playwright.assignments.config.ts`).

import { expect, test } from '@playwright/test'
import { readE2eAssignmentsEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  cleanupDisposableClient,
  createDisposableClient,
  createDisposableShift,
  createDisposableSite,
  getAdminClient,
} from './helpers/adminClient.ts'
import { addDaysInBuenosAires } from './helpers/nearDates.ts'
import { loginAs } from './helpers/login.ts'
import { expectNoHorizontalScroll } from './helpers/noHorizontalScroll.ts'
import { expectAssignSuccessToast } from './helpers/assignToast.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

const env = readE2eAssignmentsEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('ASSIGN-015: asignar desde la lista del día en celular (390 px)', () => {
  test('desde ADM-05 en 390 px entra a un turno y asigna un empleado, sin scroll horizontal', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(90_000)

    const admin = getAdminClient()
    const client = await createDisposableClient(admin, 'Cliente-Movil')
    const site = await createDisposableSite(admin, client.id, 'Sede-Movil')
    const shiftDate = addDaysInBuenosAires(4)
    const shift = await createDisposableShift(
      admin,
      client.id,
      site.id,
      shiftDate,
      {
        startTime: '08:00',
        endTime: '12:00',
        requiredStaff: 1,
      },
    )

    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      await test.step('ADM-05 (día) en 390 px: sin scroll horizontal, entra al turno con "Ver"', async () => {
        await page.goto(`/admin/planificacion?vista=dia&fecha=${shiftDate}`)
        await expect(page.getByText(site.name)).toBeVisible()
        await expectNoHorizontalScroll(page)

        // A < 1024 px `DataTable` reemplaza la tabla por una tarjeta por fila (`RowCard`, sin
        // `role="row"`): la tarjeta de este turno es la única con el nombre de la sede fixture
        // (única en esta corrida, prefijo `E2E-P114` + timestamp).
        const card = page
          .locator('div.rounded-lg', { hasText: site.name })
          .first()
        await card.getByRole('link', { name: 'Ver' }).click()
        await expect(page).toHaveURL(new RegExp(`/admin/turnos/${shift.id}$`))
      })

      await test.step('ADM-06 en página completa (< 1024 px): asigna un empleado', async () => {
        await expectNoHorizontalScroll(page)
        await page.getByRole('button', { name: 'Asignar empleado' }).click()
        await page
          .getByTestId('assign-candidate')
          .filter({ hasText: 'Lucía Torres' })
          .click()
        await page.getByRole('button', { name: 'Asignar' }).click()
        await expectAssignSuccessToast(page)
        await expect(page.getByText('Dotación: 1/1')).toBeVisible()
      })
    } finally {
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
