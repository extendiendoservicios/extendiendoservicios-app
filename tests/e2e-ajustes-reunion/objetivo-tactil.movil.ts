import { expect, test } from '@playwright/test'
import { nombreDe } from '../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'

// P19.5h · DEF de P19.5d (menor, corregido en P19.5f): el enlace de cada fila de «Supervisiones de
// hoy» medía 38 px de alto a 390 px; el Design System pide objetivos táctiles de 44 px o más.
// Se mide la caja real de los enlaces del bloque con una jornada del día (P24.5); el recorrido completo de objetivos
// táctiles está en `tests/e2e-responsive/touch-targets.spec.ts`.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('admin') })

test(
  'el enlace de cada supervisión del día mide 44 px o más a 390 px',
  cubre('RB-X01', 'RB-A06'),
  async ({ page }) => {
    const sc = new Scenario()
    try {
      // P24.4: el bloque lista las jornadas de los coordinadores (abiertas y cerradas solas), cada una
      // con su enlace a la ficha; ya no lista las supervisiones asignadas.
      await sc.asegurarJornada('supervisor1')

      await page.goto('/admin')
      const bloque = page.getByRole('region', { name: 'Supervisiones de hoy' })
      const enlace = bloque.getByRole('link', {
        name: new RegExp(nombreDe('supervisor1')),
      })
      await expect(enlace.first()).toBeVisible()
      for (const unEnlace of await bloque.getByRole('link').all()) {
        const caja = await unEnlace.boundingBox()
        expect(caja, 'el enlace tiene caja').not.toBeNull()
        expect(caja!.height).toBeGreaterThanOrEqual(44)
      }
      await expectNoHorizontalScroll(page)
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
