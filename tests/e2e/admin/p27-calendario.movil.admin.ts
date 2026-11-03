import { expect, test, type Page } from '@playwright/test'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'
import { todayAR } from '../../fixtures/dates.ts'

// P27.8 (OD-26): «Generar turnos del mes» y «Nuevo turno» a 390 px en las tres vistas del
// calendario (proyecto `mobile`). Antes estaban solo en la vista de mes, que en el celular no se
// usa. En pantallas angostas pasan a íconos con etiqueta accesible: el nombre accesible sigue
// siendo el texto, el botón queda dentro de la pantalla, en la misma fila que el selector
// Mes/Semana/Día y sin desbordar.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

async function verAcciones(page: Page) {
  const selector = page.getByRole('radiogroup', {
    name: 'Vista del calendario',
  })
  await expect(selector).toBeVisible()
  const generar = page.getByRole('link', { name: 'Generar turnos del mes' })
  const nuevo = page.getByRole('link', { name: 'Nuevo turno' })
  await expect(generar).toBeVisible()
  await expect(nuevo).toBeVisible()
  const ancho = page.viewportSize()?.width ?? 390
  const cajaSelector = (await selector.boundingBox())!
  for (const boton of [generar, nuevo]) {
    const caja = (await boton.boundingBox())!
    expect(
      caja.x,
      'dentro de la pantalla, a la izquierda',
    ).toBeGreaterThanOrEqual(0)
    expect(
      caja.x + caja.width,
      'dentro de la pantalla, a la derecha',
    ).toBeLessThanOrEqual(ancho)
    // Misma fila que el selector: se superponen en vertical.
    expect(caja.y).toBeLessThan(cajaSelector.y + cajaSelector.height)
    expect(caja.y + caja.height).toBeGreaterThan(cajaSelector.y)
    // Alineados a la derecha del selector.
    expect(caja.x).toBeGreaterThanOrEqual(
      cajaSelector.x + cajaSelector.width - 1,
    )
    // Botones de tamaño táctil.
    expect(caja.height).toBeGreaterThanOrEqual(40)
    expect(caja.width).toBeGreaterThanOrEqual(40)
  }
  await expectNoHorizontalScroll(page)
  return { generar, nuevo }
}

test(
  'los botones «Generar turnos del mes» y «Nuevo turno» se ven en semana, día y mes a 390 px, sin desbordar',
  cubre('RB-A04', 'RB-A06', 'RB-X01', 'OD-26'),
  async ({ page }) => {
    const hoy = todayAR()
    for (const vista of ['semana', 'dia', 'mes']) {
      await test.step(`vista ${vista}`, async () => {
        await page.goto(`/admin/planificacion?vista=${vista}&fecha=${hoy}`)
        await verAcciones(page)
      })
    }

    await test.step('«Nuevo turno» de la vista de día lleva la fecha elegida y «Generar turnos del mes» abre su pantalla', async () => {
      await page.goto(`/admin/planificacion?vista=dia&fecha=${hoy}`)
      const { nuevo } = await verAcciones(page)
      await nuevo.click()
      await expect(page).toHaveURL(
        new RegExp(`/admin/turnos/nuevo\\?fecha=${hoy}`),
      )
      await page.goto(`/admin/planificacion?vista=semana&fecha=${hoy}`)
      const { generar } = await verAcciones(page)
      await generar.click()
      await expect(page).toHaveURL(/\/admin\/turnos\/generar$/)
    })
  },
)
