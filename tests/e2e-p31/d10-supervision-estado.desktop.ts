import { expect, test, type Locator, type Page } from '@playwright/test'
import { nombreDe } from '../fixtures/accounts.ts'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { armarSupervision, type EscenarioSupervision } from '../fixtures/p31.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'

// P31.6 · D-10 (OI-08): segunda línea en la columna Estado de «Servicios de hoy» (Resumen) y de
// Asistencia de hoy: «Supervisado», «Supervisando» (con el nombre del coordinador en el `title`) o
// «Sin supervisión»; nada en un turno que todavía no empezó ni en uno cancelado. Dueño y
// administrador la ven. Escritorio 1280 px (el celular está en `d10-supervision-estado.movil.ts`).
// Cuentas: empleado1 a empleado4 (uno por turno) y supervisor1 (el que supervisa).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

const filaDe = (zona: Locator, sede: string) =>
  zona.getByRole('row').filter({ hasText: sede })

/** Las cuatro líneas esperadas en una zona con filas (Resumen o Asistencia de hoy). */
async function verificarLineas(zona: Locator, e: EscenarioSupervision) {
  const coordinador = nombreDe('supervisor1')
  const supervisado = filaDe(zona, e.supervisado)
  await expect(supervisado).toHaveCount(1)
  await expect(supervisado.getByText(/^Supervisado/)).toHaveAttribute(
    'title',
    coordinador,
  )
  const supervisando = filaDe(zona, e.supervisando)
  await expect(supervisando.getByText(/^Supervisando/)).toHaveAttribute(
    'title',
    coordinador,
  )
  const sinSupervision = filaDe(zona, e.sinSupervision)
  await expect(sinSupervision).toContainText('Sin supervisión')
  await expect(
    sinSupervision.getByText(/^Sin supervisión/),
  ).not.toHaveAttribute('title', /.+/)
  // «Sin cerrar» ya tiene fin registrado: cuenta como supervisado.
  await expect(filaDe(zona, e.sinCerrar)).toContainText('Supervisado')
  if (e.sinEmpezar) {
    const pendiente = filaDe(zona, e.sinEmpezar)
    await expect(pendiente).toHaveCount(1)
    await expect(pendiente).not.toContainText(/Supervis|Sin supervisión/)
  }
}

async function esperarFilas(zona: Locator, e: EscenarioSupervision) {
  await expect(filaDe(zona, e.supervisado)).toHaveCount(1)
  await expect(filaDe(zona, e.sinSupervision)).toHaveCount(1)
}

for (const quien of ['owner', 'admin'] as const) {
  test.describe(`segunda línea de supervisión vista por ${quien === 'owner' ? 'el dueño' : 'un administrador'} (D-10)`, () => {
    test.use({ storageState: storageStatePath(quien) })

    test(
      '«Servicios de hoy» del Resumen y «Asistencia de hoy» muestran Supervisado, Supervisando y Sin supervisión; nada si el turno no empezó',
      cubre('RB-A06', 'RB-A08', 'OI-08', 'D-10', 'CJ-22'),
      async ({ page }: { page: Page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          const e = await armarSupervision(sc)

          await test.step('Resumen › Servicios de hoy', async () => {
            await page.goto('/admin')
            const zona = page.getByRole('region', { name: 'Servicios de hoy' })
            await esperarFilas(zona, e)
            await verificarLineas(zona, e)
          })

          await test.step('Asistencia de hoy', async () => {
            await page.goto('/admin/asistencia')
            const zona = page.getByRole('main')
            await esperarFilas(zona, e)
            await verificarLineas(zona, e)
          })
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })
}
