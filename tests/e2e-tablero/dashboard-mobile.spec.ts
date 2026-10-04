// tests/e2e-tablero/dashboard-mobile.spec.ts — DASH-008 (P16.2, 08_Fases_y_Backlog.md F16, D29)
//
// Tablero operativo (ADM-02) a 390 px, contra App_dev:
//  - KPIs en dos columnas (la quinta tarjeta ocupa el ancho completo).
//  - Con más de 5 alertas, solo 5 visibles y un botón "Ver las N" que despliega el resto.
//  - "Servicios de hoy" como lista de tarjetas con las acciones al pie de cada tarjeta.
//  - Sin scroll horizontal.

import { expect, test } from '@playwright/test'
import { MISSING_ENV_MESSAGE, readE2eTableroEnv } from './helpers/env.ts'
import {
  NEAR_MIDNIGHT_MESSAGE,
  TableroScenario,
  isTooCloseToMidnight,
} from './helpers/fixtures.ts'
import {
  alertCard,
  attentionSection,
  buildManyAlertsScenario,
  expectNoHorizontalScroll,
  kpiSection,
  servicesSection,
  waitForDashboardLoaded,
} from './helpers/dashboard.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../fixtures/seed-accounts.ts'

const env = readE2eTableroEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

const VIEWPORT_WIDTH = 390

test.describe('DASH-008: tablero operativo a 390 px (D29)', () => {
  test.beforeEach(() => {
    test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)
  })

  test('RB-A07: KPIs en dos columnas, cinco alertas con "Ver las N", acciones al pie y sin scroll horizontal', async ({
    page,
  }, testInfo) => {
    const scenario = new TableroScenario()
    try {
      const data = await buildManyAlertsScenario(scenario)
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
      await waitForDashboardLoaded(page)

      await test.step('KPIs en dos columnas; la quinta tarjeta ocupa el ancho completo', async () => {
        const cards = kpiSection(page).locator(':scope > div')
        await expect(cards).toHaveCount(5)
        const boxes = []
        for (let index = 0; index < 5; index += 1) {
          const box = await cards.nth(index).boundingBox()
          expect(box, `tarjeta KPI ${index}`).not.toBeNull()
          boxes.push(box!)
        }
        const [first, second, third, fourth, fifth] = boxes as [
          (typeof boxes)[number],
          (typeof boxes)[number],
          (typeof boxes)[number],
          (typeof boxes)[number],
          (typeof boxes)[number],
        ]
        // Primera fila: dos tarjetas lado a lado. Segunda fila: otras dos debajo.
        expect(second.x).toBeGreaterThan(first.x + first.width / 2)
        expect(Math.abs(second.y - first.y)).toBeLessThan(2)
        expect(third.y).toBeGreaterThan(first.y + first.height - 2)
        expect(Math.abs(third.x - first.x)).toBeLessThan(2)
        expect(Math.abs(fourth.y - third.y)).toBeLessThan(2)
        // Quinta: debajo y de ancho completo (más del doble de media columna, menos el hueco).
        expect(fifth.y).toBeGreaterThan(third.y + third.height - 2)
        expect(fifth.width).toBeGreaterThan(first.width * 1.8)
        await testInfo.attach('390-kpis', {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
      })

      const badge = Number(
        await attentionSection(page).locator('h2 + span').innerText(),
      )
      expect(badge).toBeGreaterThanOrEqual(data.alertCount)
      const items = attentionSection(page).getByRole('listitem')

      await test.step('con más de 5 alertas solo se ven 5 y aparece "Ver las N"', async () => {
        await expect(items).toHaveCount(5)
        await expect(
          attentionSection(page).getByRole('button', {
            name: `Ver las ${badge}`,
          }),
        ).toBeVisible()
        await expectNoHorizontalScroll(page, VIEWPORT_WIDTH)
      })

      await test.step('las acciones van al pie de cada tarjeta de alerta', async () => {
        const firstCard = items.first()
        const text = await firstCard.locator('p').last().boundingBox()
        const actions = await firstCard
          .getByRole('link', { name: 'Abrir turno' })
          .boundingBox()
        expect(text).not.toBeNull()
        expect(actions).not.toBeNull()
        expect(actions!.y).toBeGreaterThanOrEqual(text!.y + text!.height - 1)
      })

      await test.step('"Ver las N" despliega el resto y después "Ver menos" lo recoge', async () => {
        await attentionSection(page)
          .getByRole('button', { name: `Ver las ${badge}` })
          .click()
        await expect(items).toHaveCount(badge)
        // Todas las alertas propias quedan a la vista.
        await expect(
          alertCard(page, data.employeeNoRecord.lastName),
        ).toHaveCount(1)
        await expect(
          alertCard(page, data.employeeAbsence.lastName),
        ).toHaveCount(1)
        await expect(alertCard(page, data.siteUncovered.name)).toHaveCount(1)
        await expect(
          alertCard(page, data.overdueEmployee.lastName),
        ).toContainText('sigue en curso pasada su hora de fin')
        await expectNoHorizontalScroll(page, VIEWPORT_WIDTH)
        await attentionSection(page)
          .getByRole('button', { name: 'Ver menos' })
          .click()
        await expect(items).toHaveCount(5)
      })

      await test.step('"Servicios de hoy" es una lista de tarjetas con las acciones al pie', async () => {
        const services = servicesSection(page)
        await expect(services.getByRole('columnheader')).toHaveCount(0)
        // La tarjeta de `DataTable` es un `div` sin rol: es el padre de su lista `dl` de datos.
        const card = services
          .locator('xpath=.//dl/..')
          .filter({ hasText: data.employeeNoRecord.lastName })
        await expect(card).toHaveCount(1)
        await card.scrollIntoViewIfNeeded()
        const estado = await card
          .getByText('Estado', { exact: true })
          .boundingBox()
        const open = await card
          .getByRole('link', { name: 'Abrir turno' })
          .boundingBox()
        expect(estado).not.toBeNull()
        expect(open).not.toBeNull()
        expect(open!.y).toBeGreaterThan(estado!.y)
        await expect(
          card.getByRole('button', { name: 'Registrar en nombre' }),
        ).toBeVisible()
        await expectNoHorizontalScroll(page, VIEWPORT_WIDTH)
        await testInfo.attach('390-servicios-de-hoy', {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        })
      })
    } finally {
      await scenario.cleanup()
    }
  })
})
