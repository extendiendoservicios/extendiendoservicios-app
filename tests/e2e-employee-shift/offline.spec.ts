// tests/e2e-employee-shift/offline.spec.ts — MOB-EMP-017/TEST-010 (P13.4, MOB-EMP-015,
// 08_Fases_y_Backlog.md F13)
//
// Sin conexión (`context.setOffline(true)`) en servicio en curso, tareas, observación y
// finalizar: los botones que escriben quedan deshabilitados con un aviso claro. La navegación
// entre pantallas, mientras está offline, es siempre por los enlaces propios de la aplicación
// (`Link` de React Router, sin recarga completa) -- un `page.goto()` con la conexión cortada
// recargaría el documento entero y fallaría por un motivo ajeno a lo que se quiere probar acá.

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
  assignEmployeeToShift,
  createTodayShift,
  createTodayShiftTask,
} from './helpers/shiftFixture.ts'
import { loginAs } from './helpers/login.ts'

const env = readE2eEmployeeShiftEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.use({ permissions: [] })

test.describe('MOB-EMP-017: sin conexión, los botones que escriben quedan deshabilitados (MOB-EMP-015)', () => {
  test('en curso, tareas, observaciones y finalizar', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(90_000)

    const admin = getAdminClient()
    const employee = await createDisposableEmployee(
      admin,
      'offline',
      env!.seedPassword,
    )
    const client = await createDisposableClient(admin, 'Cliente-Offline')
    const site = await createDisposableSite(admin, client.id, 'Sede-Offline')
    const shift = await createTodayShift(admin, client.id, site.id)
    await createTodayShiftTask(
      admin,
      shift.shiftId,
      0,
      'E2E-P134 tarea offline',
      true,
    )
    const assignmentId = await assignEmployeeToShift(
      shift.shiftId,
      employee.profileId,
    )

    try {
      await loginAs(page, employee.email, employee.password, /\/app$/)
      await page.goto('/app/fichar')
      await page.getByRole('button', { name: 'Continuar' }).click()
      await page
        .getByRole('button', { name: 'Continuar sin ubicación' })
        .click()
      await page.getByRole('button', { name: 'Registrar inicio' }).click()
      await expect(page).toHaveURL(new RegExp(`/app/en-curso/${assignmentId}$`))

      // Precalienta la caché de tareas ONLINE: si la primera visita a "Tareas" pasara offline,
      // la propia lectura de las tareas fallaría y no habría nada que ver en esa pantalla -- lo
      // que se quiere probar acá es que la EDICIÓN queda deshabilitada, no que la lectura
      // funcione sin conexión (fuera de alcance de esta vía, sin cola ni sincronización).
      await page.getByRole('link', { name: /Tareas/ }).click()
      await expect(page.getByText('E2E-P134 tarea offline')).toBeVisible()
      await page.getByRole('button', { name: 'Volver' }).click()
      await expect(page).toHaveURL(new RegExp(`/app/en-curso/${assignmentId}$`))

      await page.context().setOffline(true)

      await test.step('En curso: banner de sin conexión', async () => {
        await expect(
          page.getByText(
            'Estás sin conexión. Vas a poder seguir viendo tu servicio, pero registrar cosas nuevas va a esperar a que vuelvas a tener señal.',
          ),
        ).toBeVisible()
      })

      await test.step('Tareas: banner y casillero deshabilitados, sin botón "No realizada"', async () => {
        await page.getByRole('link', { name: /Tareas/ }).click()
        await expect(
          page.getByText(
            'Estás sin conexión: no podés marcar tareas hasta que vuelvas a tener señal.',
          ),
        ).toBeVisible()
        await expect(
          page.getByRole('checkbox', { name: /tarea offline/ }),
        ).toBeDisabled()
        await expect(
          page.getByRole('button', { name: 'No realizada' }),
        ).toHaveCount(0)
        await page.getByRole('button', { name: 'Volver' }).click()
      })

      await test.step('Observaciones: banner, textarea y botón "Guardar" deshabilitados', async () => {
        await page.getByRole('link', { name: /Observaciones/ }).click()
        await expect(
          page.getByText(
            'Estás sin conexión: no podés guardar la observación hasta que vuelvas a tener señal.',
          ),
        ).toBeVisible()
        await expect(
          page.getByPlaceholder('Escribí tu observación (opcional)…'),
        ).toBeDisabled()
        await expect(
          page.getByRole('button', { name: 'Guardar' }),
        ).toBeDisabled()
        await page.getByRole('button', { name: 'Volver' }).click()
      })

      await test.step('Finalizar: banner y botón "Registrar fin" deshabilitados', async () => {
        await page.getByRole('link', { name: /Finalizar servicio/ }).click()
        await expect(
          page.getByText(
            'Estás sin conexión. Conectate para poder registrar el fin.',
          ),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Registrar fin' }),
        ).toBeDisabled()
      })

      await test.step('Al volver la conexión, se puede finalizar con normalidad', async () => {
        await page.context().setOffline(false)
        await expect(
          page.getByRole('button', { name: 'Registrar fin' }),
        ).toBeEnabled()
        await page.getByRole('button', { name: 'Registrar fin' }).click()
        await expect(page).toHaveURL(
          new RegExp(`/app/resumen/${assignmentId}$`),
        )
      })
    } finally {
      await page.context().setOffline(false)
      await deactivateDisposableEmployee(admin, employee.profileId)
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
