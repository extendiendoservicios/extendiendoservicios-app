import { expect, test, type Locator, type Page } from '@playwright/test'
import { FRANJAS } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'

// P19.11g · Calendario (P19.11d y P19.11f, punto 6 de la reunión del 19 oct).
//   - Semana (ADM-04) a 1024 px con el menú abierto: el contenido mide 736 px y la grilla pide 760,
//     así que hay desplazamiento horizontal DENTRO de la grilla (no de la página) y el horario del
//     chip se ve completo. Con el menú cerrado, o desde 1280 px, la grilla entra sin desplazar.
//   - Día (ADM-05) a 1024 px con el menú abierto: sin desplazamiento horizontal y con el
//     encabezado «Coordinador» separado de «Estado».
// Cuentas: admin y empleado1.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({
  storageState: storageStatePath('admin'),
  viewport: { width: 1024, height: 768 },
})

/** Ancho que sobra (positivo) de una caja con desplazamiento: scrollWidth - clientWidth. */
async function excedente(caja: Locator): Promise<number> {
  return caja.evaluate((el) => el.scrollWidth - el.clientWidth)
}

async function paginaSinDesplazamiento(page: Page): Promise<void> {
  const exceso = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  )
  expect(exceso, 'la página no se desplaza en horizontal').toBeLessThanOrEqual(
    0,
  )
}

async function menuAbierto(page: Page): Promise<void> {
  await expect(
    page.getByRole('button', { name: 'Contraer menú' }),
  ).toBeVisible()
  const ancho = await page
    .locator('aside')
    .first()
    .evaluate((el) => el.getBoundingClientRect().width)
  expect(ancho, 'ancho del menú lateral abierto').toBe(236)
}

test(
  'semana a 1024 px con el menú abierto: la grilla se desplaza en horizontal y el horario del chip se ve completo',
  cubre('RB-A06', 'P-050'),
  async ({ page }) => {
    const sc = new Scenario()
    try {
      const cliente = await sc.client('p1911-semana')
      const sede = await sc.site(cliente.id, 'p1911-semana')
      const turno = await sc.shift(cliente.id, sede.id, sc.today, FRANJAS.tarde)
      await sc.assign(turno, 'empleado1')

      await page.goto(`/admin/planificacion?vista=semana&fecha=${sc.today}`)
      await menuAbierto(page)
      const grilla = page.getByTestId('week-grid-scroll')
      const chip = page.getByRole('link', {
        name: new RegExp(`${sede.name}.*14:00–18:00`),
      })
      await expect(chip).toBeVisible()

      await test.step('hay desplazamiento horizontal dentro de la grilla, no de la página', async () => {
        expect(
          await excedente(grilla),
          'la grilla pide más ancho del que hay (736 px de contenido contra 760 px)',
        ).toBeGreaterThan(0)
        await paginaSinDesplazamiento(page)
      })

      await test.step('el horario del chip está completo y entra en su celda', async () => {
        const rango = chip.getByTestId('week-chip-range')
        await expect(rango).toHaveText('14:00–18:00')
        const medidas = await rango.evaluate((el) => {
          const texto = document.createRange()
          texto.selectNodeContents(el)
          const celda = el.closest('td')!.getBoundingClientRect()
          return {
            textoDerecha: texto.getBoundingClientRect().right,
            celdaDerecha: celda.right,
            desborde: el.scrollWidth - el.clientWidth,
          }
        })
        expect(medidas.textoDerecha).toBeLessThanOrEqual(
          medidas.celdaDerecha + 0.5,
        )
        expect(medidas.desborde).toBeLessThanOrEqual(1)
      })

      await test.step('con el menú cerrado la grilla entra sin desplazar', async () => {
        await page.getByRole('button', { name: 'Contraer menú' }).click()
        await expect(
          page.getByRole('button', { name: 'Expandir menú' }),
        ).toBeVisible()
        await expect.poll(() => excedente(grilla)).toBeLessThanOrEqual(0)
        await paginaSinDesplazamiento(page)
        await expect(chip.getByTestId('week-chip-range')).toHaveText(
          '14:00–18:00',
        )
        // Se repone la preferencia del menú (queda guardada en el navegador).
        await page.getByRole('button', { name: 'Expandir menú' }).click()
      })

      await test.step('a 1280 px con el menú abierto también entra sin desplazar', async () => {
        await page.setViewportSize({ width: 1280, height: 800 })
        await menuAbierto(page)
        await expect.poll(() => excedente(grilla)).toBeLessThanOrEqual(0)
        await paginaSinDesplazamiento(page)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'día a 1024 px con el menú abierto: sin desplazamiento horizontal y con «Coordinador» separado de «Estado»',
  cubre('RB-A06', 'RB-S02', 'P-050'),
  async ({ page }) => {
    const sc = new Scenario()
    try {
      const cliente = await sc.client('p1911-dia')
      const sede = await sc.site(cliente.id, 'p1911-dia')
      const turno = await sc.shift(cliente.id, sede.id, sc.today, FRANJAS.tarde)
      await sc.assign(turno, 'empleado1')
      await sc.assignSupervision(turno, 'supervisor1')

      await page.goto(`/admin/planificacion?vista=dia&fecha=${sc.today}`)
      await menuAbierto(page)
      const tabla = page.getByRole('table').first()
      const fila = page.getByRole('row').filter({ hasText: cliente.name })
      await expect(fila).toBeVisible()
      await expect(fila).toContainText('14:00–18:00')

      await paginaSinDesplazamiento(page)
      const contenedor = await tabla.evaluate((el) => {
        let caja: HTMLElement | null = el.parentElement
        while (caja && getComputedStyle(caja).overflowX === 'visible') {
          caja = caja.parentElement
        }
        return caja ? caja.scrollWidth - caja.clientWidth : 0
      })
      expect(
        contenedor,
        'la tabla del día entra en su contenedor sin desplazar',
      ).toBeLessThanOrEqual(0)

      await test.step('los encabezados «Coordinador» y «Estado» no se pegan', async () => {
        const coordinador = tabla.getByRole('columnheader', {
          name: 'Coordinador',
        })
        const estado = tabla.getByRole('columnheader', { name: 'Estado' })
        await expect(coordinador).toBeVisible()
        const cajaC = await coordinador.boundingBox()
        const cajaE = await estado.boundingBox()
        expect(cajaC && cajaE).toBeTruthy()
        expect(cajaC!.x + cajaC!.width).toBeLessThanOrEqual(cajaE!.x + 0.5)
        // El texto del encabezado no se sale de su celda hacia la vecina.
        const sobra = await coordinador.evaluate((el) => {
          const texto = document.createRange()
          texto.selectNodeContents(el)
          return (
            texto.getBoundingClientRect().right -
            el.getBoundingClientRect().right
          )
        })
        expect(sobra).toBeLessThanOrEqual(0.5)
      })

      await test.step('las acciones con ícono conservan sus nombres accesibles', async () => {
        await expect(fila.getByRole('link', { name: 'Ver' })).toBeVisible()
        await expect(fila.getByRole('link', { name: 'Editar' })).toBeVisible()
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
