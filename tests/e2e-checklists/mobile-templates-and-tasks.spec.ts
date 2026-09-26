// tests/e2e-checklists/mobile-templates-and-tasks.spec.ts — TASK-009 (P12.3, 08_Fases_y_Backlog.md
// F12, encargo P12.3: "un caso a 390 px de ADM-26 y de las tareas de ADM-06")
//
// A 390 px: ADM-26 (plantilla del cliente, alta de ítems) y la sección Tareas de ADM-06 (marcar
// el estado de una tarea) sin scroll horizontal. Corre en el proyecto `mobile`
// (`playwright.checklists.config.ts`, 390×844). Fixture liviano propio (prefijo `E2E-P123`), un
// solo cliente con una sede y un turno puntual del año 2199 reservado por esta suite.

import { expect, test } from '@playwright/test'
import { readE2eChecklistsEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  cleanupDisposableClient,
  createDisposableClient,
  createDisposableSite,
  fetchShiftTasks,
  getAdminClient,
} from './helpers/adminClient.ts'
import { FAR_DATE_MOBILE_SHIFT } from './helpers/farDate.ts'
import { loginAs } from './helpers/login.ts'
import { expectNoHorizontalScroll } from './helpers/noHorizontalScroll.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

const env = readE2eChecklistsEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('TASK-009: ADM-26 y las tareas de ADM-06 en 390 px', () => {
  test('crea un ítem en ADM-26 y marca una tarea en ADM-06, sin scroll horizontal', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(90_000)

    const admin = getAdminClient()
    const client = await createDisposableClient(admin, 'Cliente-Movil')
    const site = await createDisposableSite(admin, client.id, 'Sede-Movil')

    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      await test.step('ADM-26 en 390 px: crea la plantilla del cliente y un ítem, sin scroll horizontal', async () => {
        await page.goto(`/admin/tareas?cliente=${client.id}`)
        await expectNoHorizontalScroll(page)
        await page
          .getByRole('button', { name: 'Crear plantilla del cliente' })
          .click()
        await expect(
          page.getByText('Creamos la plantilla del cliente.'),
        ).toBeVisible()
        await expectNoHorizontalScroll(page)

        await page.getByRole('button', { name: 'Agregar ítem' }).click()
        await page.getByLabel('Título').fill('Limpiar vidrios')
        await page.getByRole('button', { name: 'Guardar' }).click()
        await expect(page.getByText('Agregamos el ítem.')).toBeVisible()
        await expectNoHorizontalScroll(page)
      })

      let shiftId = ''
      await test.step('ADM-07: crea un turno puntual para la sede (toma la plantilla del cliente)', async () => {
        // La fecha se pasa por query string (`?fecha=`, ver `ShiftFormPage`): evita repetir acá
        // la navegación por teclado del `DatePicker` (ya cubierta en el spec de escritorio).
        await page.goto(`/admin/turnos/nuevo?fecha=${FAR_DATE_MOBILE_SHIFT}`)
        await page.getByRole('combobox', { name: 'Cliente' }).click()
        await page.getByRole('option', { name: client.legalName }).click()
        await page.getByRole('combobox', { name: 'Sede' }).click()
        await page.getByRole('option', { name: site.name }).click()
        await page.getByLabel('Desde').fill('08:00')
        await page.getByLabel('Hasta').fill('12:00')
        await page.getByRole('button', { name: 'Crear turno' }).click()
        await expect(page.getByText('Creamos el turno.')).toBeVisible()

        const { data } = await admin
          .from('shifts')
          .select('id')
          .eq('site_id', site.id)
          .eq('shift_date', FAR_DATE_MOBILE_SHIFT)
          .single()
        shiftId = data!.id
      })

      await test.step('ADM-06 en 390 px: la sección Tareas se ve sin scroll horizontal y permite marcar un estado', async () => {
        await page.goto(`/admin/turnos/${shiftId}`)
        await expect(page.getByText('Limpiar vidrios')).toBeVisible()
        await expectNoHorizontalScroll(page)

        const statusSelect = page.getByRole('combobox', {
          name: 'Estado de "Limpiar vidrios"',
        })
        await statusSelect.click()
        await page
          .getByRole('option', { name: 'Realizada', exact: true })
          .click()
        // Espera a que el `Select` refleje el nuevo valor (la mutación es asíncrona: sin esto, la
        // lectura por API de más abajo corre antes de que `update_task_status` termine —
        // encontrado corriendo esta suite, ver el reporte del encargo).
        await expect(statusSelect).toContainText('Realizada')
        await expectNoHorizontalScroll(page)

        const tasks = await fetchShiftTasks(admin, shiftId)
        expect(tasks[0]?.status).toBe('done')
      })
    } finally {
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
