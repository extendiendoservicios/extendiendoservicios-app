// tests/e2e-employee-shift/today-and-changes.spec.ts — MOB-EMP-017/TEST-010 (P13.4, P-092, P-093,
// 08_Fases_y_Backlog.md F13)
//
// EMP-03 Hoy: tarjeta destacada, otro servicio de hoy, próximos días, y el bloque "Cambios desde
// tu última visita" -- aparece después de un cambio hecho por administración y desaparece en la
// siguiente visita (una vez que `mark_changes_seen` ya corrió sobre ese cambio).

import { expect, test } from '@playwright/test'
import { readE2eEmployeeShiftEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  cleanupDisposableClient,
  createDisposableClient,
  createDisposableSite,
  getAdminClient,
} from './helpers/adminClient.ts'
import {
  createDisposableEmployee,
  deactivateDisposableEmployee,
} from './helpers/employeeFixture.ts'
import {
  argentinaDateOffset,
  assignEmployeeToShift,
  createShiftOnDate,
  createTodayShift,
} from './helpers/shiftFixture.ts'
import { loginAs } from './helpers/login.ts'

const env = readE2eEmployeeShiftEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('MOB-EMP-017: Hoy — tarjeta destacada, próximos días y cambios (P-092, P-093)', () => {
  test('la tarjeta destacada va primero, el próximo día se ve abajo, y el bloque de cambios aparece y desaparece', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(90_000)

    const admin = getAdminClient()
    const employee = await createDisposableEmployee(
      admin,
      'hoy',
      env!.seedPassword,
    )
    const client = await createDisposableClient(admin, 'Cliente-Hoy')
    const siteFeatured = await createDisposableSite(
      admin,
      client.id,
      'Sede-Destacada',
    )
    const siteOther = await createDisposableSite(
      admin,
      client.id,
      'Sede-Otro-Hoy',
    )
    const siteUpcoming = await createDisposableSite(
      admin,
      client.id,
      'Sede-Proximo-Dia',
    )

    // Dos servicios de hoy sin superponerse (el primero, más temprano, tiene que quedar como
    // destacado -- `pickFeatured`: el primero pendiente en el orden de `v_my_day`) y uno de mañana.
    const shiftFeatured = await createTodayShift(
      admin,
      client.id,
      siteFeatured.id,
      -10,
      60,
    )
    const shiftOther = await createTodayShift(
      admin,
      client.id,
      siteOther.id,
      90,
      150,
    )
    const tomorrow = argentinaDateOffset(1)
    const shiftUpcoming = await createShiftOnDate(
      admin,
      client.id,
      siteUpcoming.id,
      tomorrow,
      '08:00',
      '12:00',
    )

    await assignEmployeeToShift(shiftFeatured.shiftId, employee.profileId)
    await assignEmployeeToShift(shiftOther.shiftId, employee.profileId)
    await assignEmployeeToShift(shiftUpcoming.shiftId, employee.profileId)

    try {
      await loginAs(page, employee.email, employee.password, /\/app$/)

      await test.step('Primera visita: se marca como vista (línea de base, sin residuos de la creación de la fixture)', async () => {
        // Un empleado recién creado nunca vio nada antes (P-092: `last_seen_changes_at` nulo, todo
        // cuenta como "cambiado"): la primerísima carga puede mostrar el bloque de cambios además
        // de las tarjetas -- `mark_changes_seen` corre igual (`TodayPage`, useEffect tras leer la
        // vista), así que una SEGUNDA visita, sin ningún cambio nuevo de por medio, ya no debería
        // mostrarlo. Recién en esa segunda visita (limpia) tiene sentido medir posiciones.
        const marcado = page.waitForResponse((response) =>
          response.url().includes('/rpc/mark_changes_seen'),
        )
        await page.goto('/app')
        // `mark_changes_seen` se dispara sin esperarlo (`TodayPage`, "fire and forget"): si se
        // recargara antes de que esa llamada termine, la próxima lectura seguiría viendo
        // `last_seen_changes_at` desactualizado y el bloque de cambios no desaparecería (carrera
        // encontrada corriendo esta suite, ver el reporte del encargo).
        await marcado
        await page.reload()
        await expect(
          page.getByText('Cambios desde tu última visita'),
        ).toHaveCount(0)
      })

      await test.step('Hoy: tarjeta destacada arriba, el otro servicio de hoy debajo, y el próximo día más abajo', async () => {
        const featuredLocator = page.getByText(siteFeatured.name)
        const otherLocator = page.getByText(siteOther.name)
        const upcomingLocator = page.getByText(siteUpcoming.name)
        await expect(featuredLocator).toBeVisible()
        await expect(otherLocator).toBeVisible()
        await expect(upcomingLocator).toBeVisible()

        const boxFeatured = await featuredLocator.boundingBox()
        const boxOther = await otherLocator.boundingBox()
        const boxUpcoming = await upcomingLocator.boundingBox()
        expect(boxFeatured!.y).toBeLessThan(boxOther!.y)
        expect(boxOther!.y).toBeLessThan(boxUpcoming!.y)
      })

      await test.step('Administración cambia el turno destacado: el bloque de cambios aparece en la próxima visita', async () => {
        // Cambio hecho por administración, directo en la Base (mismo criterio que un ajuste real
        // desde ADM-06/ADM-07): el trigger `trg_set_updated_at` de `shifts` pone `updated_at =
        // now()`, que es justo lo que compara `changed_since_last_seen` contra
        // `profiles.last_seen_changes_at` (P-092).
        await admin
          .from('shifts')
          .update({ notes: 'E2E-P134: turno reprogramado por administración' })
          .eq('id', shiftFeatured.shiftId)

        const marcado = page.waitForResponse((response) =>
          response.url().includes('/rpc/mark_changes_seen'),
        )
        await page.reload()
        await expect(
          page.getByText('Cambios desde tu última visita'),
        ).toBeVisible()
        await expect(
          page.getByText(siteFeatured.name, { exact: false }).first(),
        ).toBeVisible()
        // Esta misma visita también dispara su propio `mark_changes_seen` (mismo "fire and
        // forget" de arriba): hay que esperarlo antes de la PRÓXIMA recarga, o esa carrera hace
        // que el bloque siga apareciendo un ciclo de más.
        await marcado
      })

      await test.step('Siguiente visita: el bloque de cambios ya desapareció', async () => {
        await page.reload()
        await expect(
          page.getByText('Cambios desde tu última visita'),
        ).toHaveCount(0)
      })
    } finally {
      await deactivateDisposableEmployee(admin, employee.profileId)
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
