import { expect, test } from '@playwright/test'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'

// P19.5h · DEF de P19.5d (menor, corregido en P19.5f): el enlace de cada fila de «Supervisiones de
// hoy» medía 38 px de alto a 390 px; el Design System pide objetivos táctiles de 44 px o más.
// Se mide la caja real del enlace con una supervisión del día; el recorrido completo de objetivos
// táctiles está en `tests/e2e-responsive/touch-targets.spec.ts`.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('admin') })

test(
  'el enlace de cada supervisión del día mide 44 px o más a 390 px',
  cubre('RB-X01', 'RB-A06'),
  async ({ page }) => {
    const sc = new Scenario()
    try {
      const cliente = await sc.client('tactil-sup')
      const sede = await sc.site(cliente.id, 'tactil-sup')
      // Franja de todo el día: el bloque la lista sin importar la hora de la corrida.
      const turno = await sc.shift(cliente.id, sede.id, sc.today, {
        start: '00:00',
        end: '23:59',
      })
      await sc.assignSupervision(turno, 'supervisor1')

      await page.goto('/admin')
      const bloque = page.getByRole('region', { name: 'Supervisiones de hoy' })
      const enlace = bloque.getByRole('link', {
        name: new RegExp(cliente.name),
      })
      await expect(enlace).toBeVisible()
      const caja = await enlace.boundingBox()
      expect(caja, 'el enlace tiene caja').not.toBeNull()
      expect(caja!.height).toBeGreaterThanOrEqual(44)
      await expectNoHorizontalScroll(page)
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
