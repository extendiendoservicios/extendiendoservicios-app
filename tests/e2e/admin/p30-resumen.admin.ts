import { expect, test, type Locator, type Page } from '@playwright/test'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import type { FixedAccountKey } from '../../fixtures/accounts.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// P30.5 · OH-01 «Servicios de hoy con alto acotado» y OH-02 «Ancho de columnas y orden» (DataTable con
// `maxHeight`, `resizableColumns` y `persistKey`), Resumen de la administración, escritorio 1280 px.
// Se arman 15 asignaciones de hoy (cinco cuentas fijas por tres franjas de la noche) para pasar las
// 10 filas del tope. DEF-P30-06: el encabezado fijo tiene fondo opaco y queda por encima de las filas.
// Las franjas son nocturnas (18 a 21 h) y las asignaciones se hacen con la dirección, que puede
// asignar aunque el turno ya haya empezado.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const CLAVE_ALMACEN = 'datatable:resumen-servicios-hoy'
const CUENTAS: FixedAccountKey[] = [
  'empleado1',
  'empleado2',
  'empleado3',
  'empleado4',
  'empleado5',
]
const FRANJAS_NOCHE = [
  { start: '18:00', end: '19:00' },
  { start: '19:00', end: '20:00' },
  { start: '20:00', end: '21:00' },
]

/** Cliente y sede con una fila por cuenta y franja; devuelve cuántas asignaciones salieron bien. */
async function armarFilas(sc: Scenario): Promise<number> {
  const cliente = await sc.client('resumen')
  const sede = await sc.site(cliente.id, 'resumen')
  let hechas = 0
  for (const franja of FRANJAS_NOCHE) {
    const turno = await sc.shift(cliente.id, sede.id, sc.today, franja, 5)
    for (const cuenta of CUENTAS) {
      try {
        await sc.assign(turno, cuenta)
        hechas += 1
      } catch {
        // Otra prueba usa a esa persona a esa hora: se sigue con las demás.
      }
    }
  }
  return hechas
}

const seccion = (page: Page) =>
  page.getByRole('region', { name: 'Servicios de hoy' })
const contenedor = (page: Page) =>
  seccion(page).locator('[data-slot="table-container"]')

async function abrirResumen(page: Page) {
  await page.goto('/admin')
  await expect(seccion(page)).toBeVisible()
  // Las 15 asignaciones tienen que estar a la vista de la tabla.
  await expect
    .poll(async () => seccion(page).locator('tbody tr').count())
    .toBeGreaterThanOrEqual(12)
}

/** La tabla está bastante abajo en la página: se trae a la vista para poder usar el mouse. */
async function traerALaVista(page: Page) {
  await contenedor(page).evaluate((el) =>
    el.scrollIntoView({ block: 'center' }),
  )
}

const ancho = async (celda: Locator) => (await celda.boundingBox())!.width

test.describe('Resumen: «Servicios de hoy» (OH-01, OH-02)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'la tabla muestra unas 10 filas y se desplaza adentro con el encabezado fijo, opaco y por encima de las filas (DEF-P30-06)',
    cubre('RB-A06', 'OH-01', 'DEF-P30-06'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const hechas = await armarFilas(sc)
        test.skip(hechas < 11, 'no se pudieron armar filas suficientes')
        await abrirResumen(page)

        await test.step('alto acotado: la tabla no pasa de ~600 px (encabezado + 10 filas) y se desplaza por dentro', async () => {
          const caja = await contenedor(page).boundingBox()
          expect(caja!.height).toBeLessThanOrEqual(610)
          const medidas = await contenedor(page).evaluate((el) => ({
            alto: el.clientHeight,
            total: el.scrollHeight,
          }))
          expect(
            medidas.total,
            'hay más contenido que alto visible: el desplazamiento es interno',
          ).toBeGreaterThan(medidas.alto)
          // La página no creció con todas las filas: el mapa de presencia sigue cerca de la tabla.
          const mapa = page.getByRole('region', { name: 'Mapa de presencia' })
          await expect(mapa).toBeVisible()
          const cajaMapa = await mapa.boundingBox()
          const cajaSeccion = await seccion(page).boundingBox()
          expect(
            Math.abs(cajaMapa!.y - (cajaSeccion!.y + cajaSeccion!.height)) <
              cajaSeccion!.height || cajaMapa!.y < cajaSeccion!.y,
            'el mapa no queda empujado más allá del alto de la tabla',
          ).toBe(true)
        })

        await test.step('al desplazar, el encabezado se queda arriba, opaco y encima de las filas', async () => {
          const contenido = contenedor(page)
          await traerALaVista(page)
          await contenido.evaluate((el) => {
            el.scrollTop = 300
          })
          const cabecera = seccion(page).locator('thead th').first()
          await expect
            .poll(async () => contenido.evaluate((el) => el.scrollTop))
            .toBeGreaterThan(100)
          const cajaContenedor = (await contenido.boundingBox())!
          const cajaCabecera = (await cabecera.boundingBox())!
          expect(
            Math.abs(cajaCabecera.y - cajaContenedor.y),
          ).toBeLessThanOrEqual(2)
          const fondo = await cabecera.evaluate(
            (el) => getComputedStyle(el).backgroundColor,
          )
          expect(fondo, 'fondo del encabezado opaco').not.toMatch(
            /rgba\(.*, 0\)|transparent/,
          )
          // En el centro de cada encabezado visible lo que se ve es el encabezado, no una fila (los
          // que quedan más allá del desplazamiento horizontal no se pueden tocar y se saltean).
          const resultados = await seccion(page)
            .locator('thead th')
            .evaluateAll((ths) => {
              const marco = ths[0]
                ?.closest('[data-slot="table-container"]')
                ?.getBoundingClientRect()
              return ths
                .map((th, i) => {
                  const r = th.getBoundingClientRect()
                  const x = r.left + r.width / 2
                  const y = r.top + r.height / 2
                  const visible =
                    marco != null &&
                    x > marco.left &&
                    x < marco.right &&
                    y > marco.top &&
                    y < marco.bottom
                  return {
                    i,
                    visible,
                    arriba:
                      document.elementFromPoint(x, y)?.closest('thead') != null,
                  }
                })
                .filter((r) => r.visible)
            })
          expect(resultados.length).toBeGreaterThanOrEqual(3)
          for (const r of resultados) {
            expect(
              r.arriba,
              `encabezado ${r.i}: nada de las filas lo tapa`,
            ).toBe(true)
          }
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'las columnas se redimensionan arrastrando el borde, se recuerdan al recargar y el doble clic vuelve al ancho original',
    cubre('RB-A06', 'OH-02'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        await armarFilas(sc)
        await abrirResumen(page)
        await page.evaluate(
          (clave) => localStorage.removeItem(clave),
          CLAVE_ALMACEN,
        )

        const columna = seccion(page).getByRole('columnheader', {
          name: /Cliente · sede/,
        })
        const borde = columna.getByRole('separator', {
          name: 'Cambiar el ancho de la columna Cliente · sede',
        })
        await expect(borde).toBeVisible()
        await expect(borde).toHaveCSS('cursor', 'col-resize')
        await traerALaVista(page)
        const original = await ancho(columna)

        await test.step('arrastrar el borde 80 px a la derecha ensancha la columna', async () => {
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
        })

        await test.step('el ancho se recuerda en el navegador y sobrevive a la recarga', async () => {
          await expect
            .poll(async () =>
              page.evaluate(
                (clave) => localStorage.getItem(clave) ?? '',
                CLAVE_ALMACEN,
              ),
            )
            .toContain('sizing')
          const ensanchada = await ancho(columna)
          await page.reload()
          await expect(columna).toBeVisible()
          await expect
            .poll(async () => Math.abs((await ancho(columna)) - ensanchada))
            .toBeLessThanOrEqual(3)
        })

        await test.step('doble clic en el borde vuelve al ancho original', async () => {
          await borde.dblclick()
          await expect
            .poll(async () => Math.abs((await ancho(columna)) - original))
            .toBeLessThanOrEqual(25)
          const guardado = await page.evaluate(
            (clave) => localStorage.getItem(clave) ?? '',
            CLAVE_ALMACEN,
          )
          expect(guardado).not.toContain('Cliente')
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'tocar el encabezado «Empleado» ordena: ascendente, descendente y sin orden; el orden se recuerda al recargar',
    cubre('RB-A06', 'OH-02'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        await armarFilas(sc)
        await abrirResumen(page)
        await page.evaluate(
          (clave) => localStorage.removeItem(clave),
          CLAVE_ALMACEN,
        )
        await page.reload()
        await expect(seccion(page)).toBeVisible()

        const encabezado = seccion(page).getByRole('columnheader', {
          name: /Empleado/,
        })
        const apellidos = async () => {
          const filas = await seccion(page)
            .locator('tbody tr')
            .evaluateAll((trs) =>
              trs.map(
                (tr) => tr.querySelector('td')?.textContent?.trim() ?? '',
              ),
            )
          // Solo las personas de las pruebas («E2E Empleado3»): el resto de App_dev no se compara.
          return filas
            .map((texto) => /Empleado(\d)/.exec(texto)?.[1])
            .filter((n): n is string => n != null)
        }
        const monotona = (numeros: string[], sentido: 1 | -1) =>
          numeros.every(
            (n, i) =>
              i === 0 || (Number(n) - Number(numeros[i - 1])) * sentido >= 0,
          )

        await expect(encabezado).toHaveAttribute('aria-sort', 'none')
        await encabezado.getByRole('button').click()
        await expect(encabezado).toHaveAttribute('aria-sort', 'ascending')
        expect(monotona(await apellidos(), 1)).toBe(true)

        await encabezado.getByRole('button').click()
        await expect(encabezado).toHaveAttribute('aria-sort', 'descending')
        expect(monotona(await apellidos(), -1)).toBe(true)

        await test.step('se recuerda al recargar', async () => {
          await page.reload()
          await expect(
            seccion(page).getByRole('columnheader', { name: /Empleado/ }),
          ).toHaveAttribute('aria-sort', 'descending')
        })

        await encabezado.getByRole('button').click()
        await expect(
          seccion(page).getByRole('columnheader', { name: /Empleado/ }),
        ).toHaveAttribute('aria-sort', 'none')
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
