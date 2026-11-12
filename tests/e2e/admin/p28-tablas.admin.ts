import { expect, test, type Page } from '@playwright/test'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { capturar } from '../../fixtures/capturas.ts'
import { cubre } from '../../fixtures/trace.ts'

// P28.7 · OF-17: las tablas siguen siendo tablas en computadora aunque el navegador esté agrandado
// (ancho efectivo angosto), con desplazamiento horizontal, barra visible y primera columna fija;
// las tarjetas quedan solo para celular real (pantalla táctil y menos de 768 px).
// Viewport 640 x 800 (equivale a 200 % de zoom sobre 1280) y 480 (250 %), con puntero fino.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('owner') })

async function medirTabla(page: Page) {
  const tabla = page.getByRole('table').first()
  await expect(tabla).toBeVisible()
  return tabla.evaluate((el) => {
    const contenedor = el.closest('div.overflow-x-auto') as HTMLElement
    const estilos = getComputedStyle(contenedor)
    const primera = el.querySelector('tbody tr td:first-child') as HTMLElement
    return {
      desborda: contenedor.scrollWidth > contenedor.clientWidth,
      overflowX: estilos.overflowX,
      primeraPosicion: primera ? getComputedStyle(primera).position : null,
      fondoPrimera: primera ? getComputedStyle(primera).backgroundColor : null,
    }
  })
}

for (const ancho of [640, 480]) {
  test(
    `a ${ancho} px con mouse: /admin/clientes sigue siendo tabla con scroll horizontal y primera columna fija`,
    cubre('RB-X01', 'RB-A03', 'OF-17'),
    async ({ page }) => {
      test.setTimeout(120_000)
      const sc = new Scenario()
      try {
        // Para que la tabla tenga al menos una fila propia.
        await sc.client('of17')
        await page.setViewportSize({ width: ancho, height: 800 })
        await page.goto('/admin/clientes')
        const medida = await medirTabla(page)
        expect(medida.overflowX).toMatch(/auto|scroll/)
        expect(
          medida.desborda,
          'la tabla desborda su contenedor: hay scroll horizontal propio',
        ).toBe(true)
        expect(medida.primeraPosicion).toBe('sticky')
        expect(
          medida.fondoPrimera,
          'la primera columna fija tiene fondo opaco',
        ).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
        // El scroll es de la tabla, no de la página.
        const pagina = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
        }))
        expect(pagina.sw).toBeLessThanOrEqual(pagina.cw + 1)
        await capturar(page, 'tabla-clientes-zoom')
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
}

test(
  'a 1280 px la tabla de clientes se ve completa, igual que antes',
  cubre('RB-X01', 'OF-17'),
  async ({ page }) => {
    await page.goto('/admin/clientes')
    await expect(page.getByRole('table').first()).toBeVisible()
    await capturar(page, 'tabla-clientes')
  },
)

test(
  'Asistencia y Planificación con el navegador agrandado no desbordan la página',
  cubre('RB-X01', 'OF-17'),
  async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 800 })
    for (const ruta of [
      '/admin/asistencia',
      '/admin/planificacion?vista=dia',
    ]) {
      await page.goto(ruta)
      await expect(page.getByRole('main')).toBeVisible()
      const pagina = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }))
      expect(
        pagina.sw,
        `${ruta}: scroll horizontal de la página`,
      ).toBeLessThanOrEqual(pagina.cw + 1)
    }
  },
)
