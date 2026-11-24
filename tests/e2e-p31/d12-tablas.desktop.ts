import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'
import { cargarJornada } from '../e2e-ajustes-reunion/helpers/historial.ts'

// P31.6 · D-12 (OI-10): las tablas de administración heredan del `DataTable` el ancho de columna
// ajustable (arrastrar el borde, doble clic para volver al original), el orden por clic en el
// encabezado (`aria-sort`) y la memoria en `localStorage` (`datatable:<persistKey>`): se recuerda al
// recargar. Sin cambiar la estética. Escritorio 1280 px, dueño. Prueba a fondo Clientes y Asistencia
// de hoy; en las demás tablas verifica que tengan los asideros de ancho y el orden por clic.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('owner') })

const ancho = async (celda: Locator) => (await celda.boundingBox())!.width

async function limpiarMemoria(page: Page, clave: string) {
  await page.evaluate((k) => localStorage.removeItem(k), `datatable:${clave}`)
}

/** Arrastra el asa de la columna 80 px a la derecha, mirando que el ancho crezca. */
async function ensanchar(page: Page, columna: Locator, nombre: string) {
  const borde = columna.getByRole('separator', {
    name: `Cambiar el ancho de la columna ${nombre}`,
  })
  await expect(borde).toBeVisible()
  await expect(borde).toHaveCSS('cursor', 'col-resize')
  await columna.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const original = await ancho(columna)
  const caja = (await borde.boundingBox())!
  const x = caja.x + caja.width / 2
  const y = caja.y + caja.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 40, y, { steps: 5 })
  await page.mouse.move(x + 80, y, { steps: 5 })
  await page.mouse.up()
  await expect
    .poll(async () => Math.round(await ancho(columna)))
    .toBeGreaterThan(Math.round(original) + 60)
  return { borde, original }
}

test.describe('tablas de administración: orden por clic y ancho recordado (D-12)', () => {
  test(
    'Clientes: ordena por «Nombre» (ascendente, descendente, sin orden), recuerda el orden y el ancho al recargar y el doble clic restituye el ancho',
    cubre('RB-A02', 'RB-A06', 'OI-10', 'D-12'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        // Creados en este orden para que el orden alfabético no coincida con el de alta.
        const c = await sc.client('d12-c')
        const a = await sc.client('d12-a')
        const b = await sc.client('d12-b')
        const nombres = [a.name, b.name, c.name]

        await page.goto('/admin/clientes')
        await limpiarMemoria(page, 'tabla:clientes')
        await page.reload()
        await page
          .getByPlaceholder('Buscar por nombre o CUIT…')
          .fill('e2e-d12-')
        await expect(
          page.getByRole('row').filter({ hasText: a.name }),
        ).toHaveCount(1)
        await expect(
          page.getByRole('row').filter({ hasText: c.name }),
        ).toHaveCount(1)

        const encabezado = page
          .getByRole('columnheader', { name: /^Nombre/ })
          .first()
        /** Los nombres de los clientes de la prueba, en el orden en que salen en pantalla. */
        const enPantalla = async () => {
          const filas = await page
            .locator('tbody tr')
            .evaluateAll((trs) =>
              trs.map(
                (tr) => tr.querySelector('td')?.textContent?.trim() ?? '',
              ),
            )
          return filas
            .map((texto) => nombres.find((n) => texto.includes(n)))
            .filter((n): n is string => n != null)
        }

        await test.step('orden por clic: ascendente, descendente y sin orden', async () => {
          await expect(encabezado).toHaveAttribute('aria-sort', 'none')
          await encabezado.getByRole('button').click()
          await expect(encabezado).toHaveAttribute('aria-sort', 'ascending')
          expect(await enPantalla()).toEqual([a.name, b.name, c.name])
          await encabezado.getByRole('button').click()
          await expect(encabezado).toHaveAttribute('aria-sort', 'descending')
          expect(await enPantalla()).toEqual([c.name, b.name, a.name])
        })

        await test.step('el orden se recuerda al recargar', async () => {
          await page.reload()
          await page
            .getByPlaceholder('Buscar por nombre o CUIT…')
            .fill('e2e-d12-')
          await expect(
            page.getByRole('columnheader', { name: /^Nombre/ }).first(),
          ).toHaveAttribute('aria-sort', 'descending')
          expect(await enPantalla()).toEqual([c.name, b.name, a.name])
          await page
            .getByRole('columnheader', { name: /^Nombre/ })
            .first()
            .getByRole('button')
            .click()
          await expect(
            page.getByRole('columnheader', { name: /^Nombre/ }).first(),
          ).toHaveAttribute('aria-sort', 'none')
        })

        await test.step('el ancho de columna se arrastra, se recuerda y el doble clic lo restituye', async () => {
          const columna = page
            .getByRole('columnheader', { name: /^Nombre/ })
            .first()
          const { borde, original } = await ensanchar(page, columna, 'Nombre')
          await expect
            .poll(() =>
              page.evaluate(
                (k) => localStorage.getItem(k) ?? '',
                'datatable:tabla:clientes',
              ),
            )
            .toContain('sizing')
          const ensanchada = await ancho(columna)
          await page.reload()
          await page
            .getByPlaceholder('Buscar por nombre o CUIT…')
            .fill('e2e-d12-')
          const despues = page
            .getByRole('columnheader', { name: /^Nombre/ })
            .first()
          await expect(despues).toBeVisible()
          await expect
            .poll(async () => Math.abs((await ancho(despues)) - ensanchada))
            .toBeLessThanOrEqual(3)
          await despues
            .getByRole('separator', {
              name: /^Cambiar el ancho de la columna Nombre/,
            })
            .dblclick()
          await expect
            .poll(async () => Math.abs((await ancho(despues)) - original))
            .toBeLessThanOrEqual(25)
          expect(borde).toBeTruthy()
        })

        await expectNoHorizontalScroll(page)
      } finally {
        await limpiarMemoria(page, 'tabla:clientes').catch(() => undefined)
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'Asistencia de hoy: ordena por «Empleado» y recuerda el ancho de «Cliente · sede» al recargar',
    cubre('RB-A06', 'RB-A08', 'OI-10', 'D-12'),
    async ({ page }) => {
      test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('d12-asist')
        const sede = await sc.site(cliente.id, 'd12-asist')
        // Dos personas en el mismo turno del día: el orden por «Empleado» cambia de sentido.
        const personas = ['empleado1', 'empleado2'] as const
        const primera = await cargarJornada(sc, {
          cliente,
          sede,
          fecha: sc.today,
          franja: { start: '00:00', end: '23:59' },
          quien: personas[0],
          entrada: '00:00',
          dotacion: 2,
        })
        await sc.assign(primera.shiftId, personas[1])

        await page.goto('/admin/asistencia')
        await limpiarMemoria(page, 'tabla:asistencia-hoy')
        await page.reload()
        const filas = page.getByRole('row').filter({ hasText: sede.name })
        await expect(filas).toHaveCount(2)

        const empleado = page.getByRole('columnheader', { name: /^Empleado/ })
        const nombresEnPantalla = async () =>
          await filas.evaluateAll((trs) =>
            trs.map((tr) => tr.querySelector('td')?.textContent?.trim() ?? ''),
          )
        await empleado.getByRole('button').click()
        await expect(empleado).toHaveAttribute('aria-sort', 'ascending')
        const ascendente = await nombresEnPantalla()
        await empleado.getByRole('button').click()
        await expect(empleado).toHaveAttribute('aria-sort', 'descending')
        expect(await nombresEnPantalla()).toEqual([...ascendente].reverse())

        const columna = page.getByRole('columnheader', {
          name: /^Cliente · sede/,
        })
        await ensanchar(page, columna, 'Cliente · sede')
        const ensanchada = await ancho(columna)
        await page.reload()
        await expect(columna).toBeVisible()
        await expect
          .poll(async () => Math.abs((await ancho(columna)) - ensanchada))
          .toBeLessThanOrEqual(3)
        await expect(
          page.getByRole('columnheader', { name: /^Empleado/ }),
        ).toHaveAttribute('aria-sort', 'descending')
      } finally {
        await limpiarMemoria(page, 'tabla:asistencia-hoy').catch(
          () => undefined,
        )
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  for (const [nombre, ruta] of [
    ['Empleados', '/admin/empleados'],
    ['Feriados', '/admin/configuracion/feriados'],
    ['Supervisiones', '/admin/supervisiones'],
  ] as const) {
    test(
      `${nombre}: la tabla tiene asideros de ancho y al menos una columna que ordena por clic`,
      cubre('RB-A06', 'OI-10', 'D-12'),
      async ({ page }) => {
        await page.goto(ruta)
        const asideros = page.locator('[data-slot="column-resizer"]')
        await expect(asideros.first()).toBeAttached()
        const ordenables = page.locator('th[aria-sort]')
        await expect(ordenables.first()).toBeAttached()
        const primero = ordenables.first()
        const antes = await primero.getAttribute('aria-sort')
        await primero.getByRole('button').click()
        await expect(primero).not.toHaveAttribute('aria-sort', antes ?? 'none')
        await expectNoHorizontalScroll(page)
      },
    )
  }

  test(
    'Usuarios: tiene asideros de ancho; el orden sigue siendo el propio de la pantalla (encabezados Nombre y Legajo con su botón)',
    cubre('RB-A06', 'OI-10', 'D-12'),
    async ({ page }) => {
      await page.goto('/admin/configuracion/usuarios')
      await expect(
        page.locator('[data-slot="column-resizer"]').first(),
      ).toBeAttached()
      const tabla = page.getByRole('table', { name: 'Usuarios y roles' })
      await expect(
        tabla.getByRole('button', { name: 'Ordenar por nombre' }),
      ).toBeVisible()
      await expect(
        tabla.getByRole('button', { name: 'Ordenar por legajo' }),
      ).toBeVisible()
      await expectNoHorizontalScroll(page)
    },
  )
})
