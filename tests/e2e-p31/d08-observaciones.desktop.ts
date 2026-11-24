import { expect, test, type Page } from '@playwright/test'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { abrirCalendario, fechaDeMes } from '../fixtures/p30.ts'
import { limpiarPersonaP31 } from '../fixtures/p31.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'

// P31.6 · D-08 (OI-06): observaciones del calendario del mes de la ficha del empleado. Un «+» por
// día, texto de 1 a 500 caracteres y color opcional, menú Editar / Cambiar color / Eliminar (baja
// lógica); varias por día; salen en la hoja impresa del mes; las cargan el dueño y los
// administradores. Escritorio 1280 px.
// Cuenta de este archivo: empleado3 (los textos empiezan con «e2e-» y se borran al final).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const DIA = fechaDeMes(45)
// El dueño y el administrador usan días distintos del mismo mes para no cruzar sus observaciones.
const DIA_ADMIN = fechaDeMes(46)

const celda = (page: Page, fecha: string) => page.getByTestId(`dia-${fecha}`)
const observaciones = (page: Page, fecha: string) =>
  celda(page, fecha).getByTestId('observacion')

async function notasDe(sc: Scenario, fecha: string) {
  const { data, error } = await sc.db
    .from('employee_calendar_notes')
    .select('id, body, color, deleted_at, created_by, updated_by')
    .eq('employee_id', readId('empleado3'))
    .eq('note_date', fecha)
    .order('created_at')
  expect(error, error?.message).toBeNull()
  return data ?? []
}

async function agregar(page: Page, fecha: string, texto: string) {
  await celda(page, fecha)
    .getByRole('button', { name: /^Agregar una observación el / })
    .click()
  const dialogo = page.getByRole('dialog')
  await expect(
    dialogo.getByRole('heading', { name: 'Agregar una observación' }),
  ).toBeVisible()
  await dialogo.getByRole('textbox', { name: 'Observación' }).fill(texto)
  await dialogo.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Agregamos la observación.')).toBeVisible()
  await expect(dialogo).toHaveCount(0)
}

async function abrirMenu(page: Page, fecha: string, texto: string) {
  await observaciones(page, fecha)
    .filter({ hasText: texto })
    .getByRole('button', { name: /^Opciones de la observación/ })
    .click()
}

test.describe('observaciones del calendario del empleado (D-08)', () => {
  test.describe('dueño', () => {
    test.use({ storageState: storageStatePath('owner') })

    test(
      'alta, varias por día, edición, cambio de color y baja; la baja es lógica',
      cubre('RB-A04', 'RB-A06', 'OI-06', 'D-08'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          await abrirCalendario(page, 'empleado3', DIA)
          await expect(celda(page, DIA)).toBeVisible()
          await expect(observaciones(page, DIA)).toHaveCount(0)

          await test.step('alta: aparece en la celda del día y queda guardada con quién la cargó', async () => {
            await agregar(
              page,
              DIA,
              'e2e-sin turnos porque está en capacitación',
            )
            await expect(observaciones(page, DIA)).toHaveCount(1)
            await expect(observaciones(page, DIA)).toContainText(
              'e2e-sin turnos porque está en capacitación',
            )
            const notas = await notasDe(sc, DIA)
            expect(notas).toHaveLength(1)
            expect(notas[0].color).toBeNull()
            expect(notas[0].created_by).toBe(readId('owner'))
          })

          await test.step('puede haber más de una por día', async () => {
            await agregar(page, DIA, 'e2e-segunda observación del mismo día')
            await expect(observaciones(page, DIA)).toHaveCount(2)
            expect(await notasDe(sc, DIA)).toHaveLength(2)
          })

          await test.step('un texto vacío no se guarda', async () => {
            await celda(page, DIA)
              .getByRole('button', { name: /^Agregar una observación el / })
              .click()
            const dialogo = page.getByRole('dialog')
            await dialogo.getByRole('button', { name: 'Guardar' }).click()
            await expect(dialogo).toContainText('Escribí la observación.')
            await dialogo.getByRole('button', { name: 'Cancelar' }).click()
            await expect(observaciones(page, DIA)).toHaveCount(2)
          })

          await test.step('edición: cambia el texto', async () => {
            await abrirMenu(page, DIA, 'segunda observación')
            await page.getByRole('menuitem', { name: 'Editar' }).click()
            const dialogo = page.getByRole('dialog')
            await expect(
              dialogo.getByRole('heading', { name: 'Editar la observación' }),
            ).toBeVisible()
            await dialogo
              .getByRole('textbox', { name: 'Observación' })
              .fill('e2e-observación corregida')
            await dialogo.getByRole('button', { name: 'Guardar' }).click()
            await expect(
              page.getByText('Guardamos la observación.'),
            ).toBeVisible()
            await expect(observaciones(page, DIA).nth(1)).toContainText(
              'e2e-observación corregida',
            )
            const bodies = (await notasDe(sc, DIA)).map((n) => n.body)
            expect(bodies).toContain('e2e-observación corregida')
            expect(bodies).not.toContain(
              'e2e-segunda observación del mismo día',
            )
          })

          await test.step('cambiar color: Violeta (índice 1) y el color de la celda cambia', async () => {
            const nota = observaciones(page, DIA).filter({
              hasText: 'e2e-observación corregida',
            })
            const antes = await nota.evaluate(
              (el) => getComputedStyle(el).backgroundColor,
            )
            await abrirMenu(page, DIA, 'observación corregida')
            await page.getByRole('menuitem', { name: 'Cambiar color' }).click()
            await page.getByRole('menuitem', { name: 'Violeta' }).click()
            await expect(
              page.getByText('Cambiamos el color de la observación.'),
            ).toBeVisible()
            await expect
              .poll(() =>
                nota.evaluate((el) => getComputedStyle(el).backgroundColor),
              )
              .not.toBe(antes)
            const guardada = (await notasDe(sc, DIA)).find(
              (n) => n.body === 'e2e-observación corregida',
            )
            expect(guardada?.color).toBe(1)
          })

          await test.step('eliminar: pide confirmación y la da de baja (baja lógica)', async () => {
            await abrirMenu(page, DIA, 'observación corregida')
            await page.getByRole('menuitem', { name: 'Eliminar' }).click()
            const dialogo = page.getByRole('dialog')
            await expect(
              dialogo.getByRole('heading', { name: 'Eliminar la observación' }),
            ).toBeVisible()
            await dialogo.getByRole('button', { name: 'Eliminar' }).click()
            await expect(
              page.getByText('Eliminamos la observación.'),
            ).toBeVisible()
            await expect(observaciones(page, DIA)).toHaveCount(1)
            const eliminada = (await notasDe(sc, DIA)).find(
              (n) => n.body === 'e2e-observación corregida',
            )
            expect(eliminada?.deleted_at, 'baja lógica').not.toBeNull()
          })

          await expectNoHorizontalScroll(page)
        } finally {
          expect(await limpiarPersonaP31(sc, 'empleado3')).toEqual([])
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )

    test(
      'la observación sale en la hoja impresa del mes y sin el botón «+»',
      cubre('RB-A04', 'RB-A06', 'OI-06', 'D-08'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          await abrirCalendario(page, 'empleado3', DIA)
          await agregar(page, DIA, 'e2e-aparece en la impresión')
          await abrirMenu(page, DIA, 'aparece en la impresión')
          await page.getByRole('menuitem', { name: 'Cambiar color' }).click()
          await page.getByRole('menuitem', { name: 'Naranja' }).click()
          await expect(
            page.getByText('Cambiamos el color de la observación.'),
          ).toBeVisible()

          await page.getByRole('button', { name: 'Imprimir' }).click()
          const hoja = page.getByTestId('print-sheet')
          await expect(hoja).toBeVisible()
          const enLaHoja = hoja
            .getByTestId('observacion')
            .filter({ hasText: 'e2e-aparece en la impresión' })
          await expect(enLaHoja).toHaveCount(1)
          await expect(
            hoja.getByRole('button', { name: /Agregar una observación/ }),
          ).toHaveCount(0)
          // Con color propio: no es el gris de «sin color».
          await expect(enLaHoja).not.toHaveCSS(
            'background-color',
            'rgb(229, 231, 235)',
          )
        } finally {
          expect(await limpiarPersonaP31(sc, 'empleado3')).toEqual([])
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })

  test.describe('administrador', () => {
    test.use({ storageState: storageStatePath('admin') })

    test(
      'un administrador también agrega, edita y elimina observaciones',
      cubre('RB-A04', 'RB-X02', 'OI-06', 'D-08', 'CB-17'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          await abrirCalendario(page, 'empleado3', DIA_ADMIN)
          await agregar(page, DIA_ADMIN, 'e2e-cargada por administración')
          const notas = await notasDe(sc, DIA_ADMIN)
          expect(notas).toHaveLength(1)
          expect(notas[0].created_by).toBe(readId('admin'))

          await abrirMenu(page, DIA_ADMIN, 'cargada por administración')
          await page.getByRole('menuitem', { name: 'Editar' }).click()
          await page
            .getByRole('dialog')
            .getByRole('textbox', { name: 'Observación' })
            .fill('e2e-editada por administración')
          await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Guardar' })
            .click()
          await expect(observaciones(page, DIA_ADMIN)).toContainText(
            'e2e-editada por administración',
          )

          await abrirMenu(page, DIA_ADMIN, 'editada por administración')
          await page.getByRole('menuitem', { name: 'Eliminar' }).click()
          await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Eliminar' })
            .click()
          await expect(observaciones(page, DIA_ADMIN)).toHaveCount(0)
        } finally {
          expect(await limpiarPersonaP31(sc, 'empleado3')).toEqual([])
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })
})
