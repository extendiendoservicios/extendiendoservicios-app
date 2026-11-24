import { expect, test, type Locator } from '@playwright/test'
import { nombreDe } from '../fixtures/accounts.ts'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { armarSupervision } from '../fixtures/p31.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'

// P31.6 · D-10 (OI-08) en el celular: las tarjetas de Asistencia de hoy y de «Servicios de hoy» (390 px)
// llevan la misma segunda línea de supervisión que la tabla de escritorio. Administrador.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)
test.use({ storageState: storageStatePath('admin') })

const tarjetaDe = (zona: Locator, sede: string) =>
  zona.locator('[data-slot="row-card"]').filter({ hasText: sede })

test(
  'las tarjetas de Asistencia de hoy y del Resumen a 390 px muestran Supervisado, Supervisando y Sin supervisión',
  cubre('RB-A06', 'RB-A08', 'OI-08', 'D-10'),
  async ({ page }) => {
    test.setTimeout(240_000)
    const sc = new Scenario()
    try {
      const e = await armarSupervision(sc)
      const coordinador = nombreDe('supervisor1')

      for (const [titulo, ruta, zona] of [
        [
          'Asistencia de hoy',
          '/admin/asistencia',
          () => page.getByRole('main'),
        ],
        [
          'Resumen',
          '/admin',
          () => page.getByRole('region', { name: 'Servicios de hoy' }),
        ],
      ] as const) {
        await test.step(titulo, async () => {
          await page.goto(ruta)
          const area = zona()
          await expect(tarjetaDe(area, e.supervisado)).toHaveCount(1)
          await expect(
            tarjetaDe(area, e.supervisado).getByText(/^Supervisado/),
          ).toHaveAttribute('title', coordinador)
          await expect(
            tarjetaDe(area, e.supervisando).getByText(/^Supervisando/),
          ).toHaveAttribute('title', coordinador)
          await expect(tarjetaDe(area, e.sinSupervision)).toContainText(
            'Sin supervisión',
          )
          await expect(tarjetaDe(area, e.sinCerrar)).toContainText(
            'Supervisado',
          )
          if (e.sinEmpezar) {
            await expect(tarjetaDe(area, e.sinEmpezar)).not.toContainText(
              /Supervis|Sin supervisión/,
            )
          }
          await expectNoHorizontalScroll(page)
        })
      }
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
