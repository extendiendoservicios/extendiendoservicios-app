// tests/e2e-checklists/template-hierarchy-and-shift-copy.spec.ts — TASK-004 a TASK-008, TEST-009
// (P12.3, 08_Fases_y_Backlog.md F12 "Checklists y tareas")
//
// Flujo completo de F12: la plantilla de un cliente con varios ítems (uno opcional), reordenada;
// la plantilla propia de una sede (clonada y modificada); un turno generado para esa sede tiene
// EXACTAMENTE sus ítems, en orden; un turno de otra sede del mismo cliente (sin plantilla propia)
// toma la del cliente; cambiar la plantilla del cliente no altera un turno ya creado (P-061);
// "Recargar tareas" desde ADM-06 lo actualiza; el administrador marca tareas desde ADM-06,
// incluida "No realizada" con motivo obligatorio (04 sección 6.3, `06_API.md` sección 9).
//
// Fechas del año 2199 (regla del encargo P12.3: "fechas fuera de rango real, por ejemplo 2199"),
// ver `helpers/farDate.ts`. Cliente y dos sedes propios y descartables (prefijo `E2E-P123`).

import { expect, test, type Page } from '@playwright/test'
import { readE2eChecklistsEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  cleanupDisposableClient,
  createDisposableClient,
  createDisposableSite,
  fetchShiftTasks,
  findShiftId,
  getAdminClient,
} from './helpers/adminClient.ts'
import {
  FAR_DATE_OTHER_SITE_SHIFT,
  FAR_DATE_SITE_SHIFT,
  FAR_MONTH,
  FAR_YEAR,
} from './helpers/farDate.ts'
import { pickFarDate } from './helpers/datePicker.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

const env = readE2eChecklistsEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

/** Agrega un ítem a la plantilla abierta en ADM-26 (`ChecklistItemFormDialog`). */
async function addChecklistItem(
  page: Page,
  title: string,
  options: { optional: boolean },
): Promise<void> {
  await page.getByRole('button', { name: 'Agregar ítem' }).click()
  await page.getByLabel('Título').fill(title)
  if (options.optional) {
    await page.getByLabel('Tarea opcional', { exact: false }).check()
  }
  await page.getByRole('button', { name: 'Guardar' }).click()
  // `.last()`: los toasts anteriores (sonner) pueden seguir en el DOM mientras se desvanecen —
  // con varios ítems agregados en el mismo test, "Agregamos el ítem." queda duplicado un
  // instante (encontrado corriendo esta suite, ver el reporte del encargo).
  await expect(page.getByText('Agregamos el ítem.').last()).toBeVisible()
}

/**
 * Compara el orden visible de los títulos de ítems de la plantilla abierta en ADM-26.
 * `page.getByRole('listitem')` a secas también matchea los toasts (sonner los renderiza como
 * `<li>`) y los ítems del menú lateral ("Resumen", etc., `<li class="list-none">`) — se filtra a
 * los `<li>` que tienen el botón "Editar" de `ChecklistItemsEditor` (`aria-label='Editar "..."'`),
 * que solo existe en las filas de esta lista (encontrado corriendo esta suite, ver el reporte del
 * encargo).
 */
async function expectItemOrder(page: Page, titles: string[]): Promise<void> {
  const items = page
    .locator('li')
    .filter({ has: page.getByRole('button', { name: /^Editar "/ }) })
  await expect(items).toHaveCount(titles.length)
  for (let i = 0; i < titles.length; i++) {
    await expect(items.nth(i)).toContainText(titles[i])
  }
}

/** Elige cliente y sede en ADM-07 (`ShiftFormPage`, formulario de alta). */
async function selectShiftClientAndSite(
  page: Page,
  clientLegalName: string,
  siteName: string,
): Promise<void> {
  await page.getByRole('combobox', { name: 'Cliente' }).click()
  await page.getByRole('option', { name: clientLegalName }).click()
  await page.getByRole('combobox', { name: 'Sede' }).click()
  await page.getByRole('option', { name: siteName }).click()
}

test.describe('TASK-008: jerarquía de plantillas (cliente/sede) y copia a los turnos', () => {
  test('plantilla del cliente, propia de una sede, copia exacta en el turno, P-061, "Recargar tareas" y marcar tareas desde ADM-06', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(150_000)

    const admin = getAdminClient()
    const client = await createDisposableClient(admin, 'Cliente-Checklists')
    const siteWithOwn = await createDisposableSite(
      admin,
      client.id,
      'Sede-Con-Plantilla-Propia',
    )
    const siteWithoutOwn = await createDisposableSite(
      admin,
      client.id,
      'Sede-Sin-Plantilla-Propia',
    )

    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      await test.step('ADM-26: crea la plantilla del cliente con tres ítems (uno opcional) y los reordena', async () => {
        await page.goto(`/admin/tareas?cliente=${client.id}`)
        await page
          .getByRole('button', { name: 'Crear plantilla del cliente' })
          .click()
        await expect(
          page.getByText('Creamos la plantilla del cliente.').last(),
        ).toBeVisible()

        await addChecklistItem(page, 'Barrer', { optional: false })
        await addChecklistItem(page, 'Sacar la basura', { optional: true })
        await addChecklistItem(page, 'Trapear', { optional: false })
        await expectItemOrder(page, ['Barrer', 'Sacar la basura', 'Trapear'])

        // Sube "Trapear" un lugar: Barrer, Trapear, Sacar la basura.
        await page.getByRole('button', { name: 'Subir "Trapear"' }).click()
        await expectItemOrder(page, ['Barrer', 'Trapear', 'Sacar la basura'])
      })

      await test.step('ADM-26: crea la plantilla propia de la sede S1 (clon de la del cliente) y la modifica', async () => {
        await page.goto(
          `/admin/tareas?cliente=${client.id}&sede=${siteWithOwn.id}`,
        )
        await expect(
          page.getByText('Esta sede usa la plantilla del cliente'),
        ).toBeVisible()
        await page
          .getByRole('button', {
            name: 'Crear plantilla propia para esta sede',
          })
          .click()
        await expect(
          page.getByText('Creamos la plantilla propia de la sede.').last(),
        ).toBeVisible()
        await expect(
          page.getByText('Plantilla propia de la sede'),
        ).toBeVisible()
        // La copia trae los mismos ítems, mismo orden, que la del cliente en este momento.
        await expectItemOrder(page, ['Barrer', 'Trapear', 'Sacar la basura'])

        await addChecklistItem(page, 'Vaciar canastos de reciclaje', {
          optional: false,
        })
        await expectItemOrder(page, [
          'Barrer',
          'Trapear',
          'Sacar la basura',
          'Vaciar canastos de reciclaje',
        ])
      })

      let shiftWithOwnId = ''
      let shiftWithoutOwnId = ''

      await test.step('ADM-07: crea un turno puntual para la sede con plantilla propia', async () => {
        await page.goto('/admin/turnos/nuevo')
        await selectShiftClientAndSite(page, client.legalName, siteWithOwn.name)
        await pickFarDate(page, 'Fecha del turno', {
          year: FAR_YEAR,
          month: FAR_MONTH,
          day: 10,
        })
        await page.getByLabel('Desde').fill('08:00')
        await page.getByLabel('Hasta').fill('12:00')
        await page.getByRole('button', { name: 'Crear turno' }).click()
        await expect(page.getByText('Creamos el turno.').last()).toBeVisible()
        shiftWithOwnId = await findShiftId(
          admin,
          siteWithOwn.id,
          FAR_DATE_SITE_SHIFT,
        )
      })

      await test.step('ADM-06: el turno tiene EXACTAMENTE los ítems de la plantilla propia de la sede, en orden', async () => {
        await page.goto(`/admin/turnos/${shiftWithOwnId}`)
        await expect(page.getByText('Barrer')).toBeVisible()

        const tasks = await fetchShiftTasks(admin, shiftWithOwnId)
        expect(tasks.map((t) => t.title)).toEqual([
          'Barrer',
          'Trapear',
          'Sacar la basura',
          'Vaciar canastos de reciclaje',
        ])
        expect(tasks.map((t) => t.isRequired)).toEqual([
          true,
          true,
          false,
          true,
        ])
      })

      await test.step('ADM-07: un turno de OTRA sede del mismo cliente (sin plantilla propia) toma la del cliente', async () => {
        await page.goto('/admin/turnos/nuevo')
        await selectShiftClientAndSite(
          page,
          client.legalName,
          siteWithoutOwn.name,
        )
        await pickFarDate(page, 'Fecha del turno', {
          year: FAR_YEAR,
          month: FAR_MONTH,
          day: 11,
        })
        await page.getByLabel('Desde').fill('08:00')
        await page.getByLabel('Hasta').fill('12:00')
        await page.getByRole('button', { name: 'Crear turno' }).click()
        await expect(page.getByText('Creamos el turno.').last()).toBeVisible()
        shiftWithoutOwnId = await findShiftId(
          admin,
          siteWithoutOwn.id,
          FAR_DATE_OTHER_SITE_SHIFT,
        )

        const tasks = await fetchShiftTasks(admin, shiftWithoutOwnId)
        expect(tasks.map((t) => t.title)).toEqual([
          'Barrer',
          'Trapear',
          'Sacar la basura',
        ])
      })

      await test.step('cambiar la plantilla del cliente NO altera el turno ya creado (P-061)', async () => {
        await page.goto(`/admin/tareas?cliente=${client.id}`)
        await expect(
          page.getByText(
            'Cambiar esta plantilla no modifica los turnos ya generados.',
          ),
        ).toBeVisible()
        await addChecklistItem(page, 'Lustrar pisos', { optional: false })
        await expectItemOrder(page, [
          'Barrer',
          'Trapear',
          'Sacar la basura',
          'Lustrar pisos',
        ])

        const tasks = await fetchShiftTasks(admin, shiftWithoutOwnId)
        expect(tasks.map((t) => t.title)).toEqual([
          'Barrer',
          'Trapear',
          'Sacar la basura',
        ])
      })

      await test.step('"Recargar tareas" desde ADM-06 actualiza el turno a la plantilla vigente', async () => {
        await page.goto(`/admin/turnos/${shiftWithoutOwnId}`)
        await page.getByRole('button', { name: 'Recargar tareas' }).click()
        await page
          .getByRole('button', { name: 'Recargar tareas' })
          .last()
          .click()
        await expect(
          page.getByText('Recargamos las tareas del turno.').last(),
        ).toBeVisible()

        const tasks = await fetchShiftTasks(admin, shiftWithoutOwnId)
        expect(tasks.map((t) => t.title)).toEqual([
          'Barrer',
          'Trapear',
          'Sacar la basura',
          'Lustrar pisos',
        ])
      })

      await test.step('el administrador marca tareas desde ADM-06, incluida "No realizada" con motivo obligatorio', async () => {
        await page.goto(`/admin/turnos/${shiftWithOwnId}`)

        await page.getByRole('combobox', { name: 'Estado de "Barrer"' }).click()
        await page.getByRole('option', { name: 'En curso' }).click()

        await page
          .getByRole('combobox', { name: 'Estado de "Trapear"' })
          .click()
        await page
          .getByRole('option', { name: 'Realizada', exact: true })
          .click()

        await page
          .getByRole('combobox', { name: 'Estado de "Sacar la basura"' })
          .click()
        await page.getByRole('option', { name: 'No realizada' }).click()
        const confirmButton = page.getByRole('button', {
          name: 'Marcar no realizada',
        })
        await expect(confirmButton).toBeDisabled()
        await page
          .getByLabel('Motivo')
          .fill('E2E-P123: no había insumos para esta tarea')
        await expect(confirmButton).toBeEnabled()
        await confirmButton.click()
        await expect(
          page.getByText('Motivo: E2E-P123: no había insumos para esta tarea'),
        ).toBeVisible()

        const tasks = await fetchShiftTasks(admin, shiftWithOwnId)
        const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t]))
        expect(byTitle['Barrer']?.status).toBe('in_progress')
        expect(byTitle['Trapear']?.status).toBe('done')
        expect(byTitle['Sacar la basura']?.status).toBe('not_done')
        expect(byTitle['Sacar la basura']?.notDoneReason).toBe(
          'E2E-P123: no había insumos para esta tarea',
        )
      })
    } finally {
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
