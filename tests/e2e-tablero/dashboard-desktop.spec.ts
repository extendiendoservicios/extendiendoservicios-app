// tests/e2e-tablero/dashboard-desktop.spec.ts — DASH-008 (P16.2, 08_Fases_y_Backlog.md F16, RB-A07)
//
// Tablero operativo (ADM-02) en escritorio, contra App_dev:
//  - Escenario con una ausencia avisada, un sin registro (pasada la hora de inicio) y un turno sin
//    cubrir: los tres aparecen en "Requiere atención" y los KPIs los cuentan.
//  - Acciones: "Abrir turno" navega a ADM-06; "Registrar en nombre" abre el panel (ADM-11) y,
//    después de registrar el inicio, el tablero se actualiza solo (sin recargar) y la alerta de
//    "sin registro" desaparece.
//  - En escritorio se muestran todas las alertas y no hay botón "Ver las N" (D29).
//  - Permisos (03 sección 6): un administrador sin `manage_attendance` no ve "Registrar en
//    nombre"; empleado y supervisor no pueden entrar a /admin.
//
// Los datos se anclan al día del turno (hoy en Argentina) con franjas fijas dentro de ese día:
// ver `helpers/fixtures.ts`. Los KPIs se verifican por diferencia contra una lectura previa: App_dev
// puede tener otros turnos de hoy que no son de esta suite.

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
  buildCoreScenario,
  buildManyAlertsScenario,
  expectKpiValue,
  readKpis,
  servicesSection,
  waitForDashboardLoaded,
} from './helpers/dashboard.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../fixtures/seed-accounts.ts'

const env = readE2eTableroEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('DASH-008: tablero operativo en escritorio (RB-A07)', () => {
  test.beforeEach(() => {
    test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)
  })

  test('RB-A07: ausencia avisada, sin registro y turno sin cubrir en "Requiere atención", KPIs, acciones y actualización sin recargar', async ({
    page,
  }) => {
    const scenario = new TableroScenario()
    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
      await waitForDashboardLoaded(page)
      const before = await readKpis(page)

      const data = await buildCoreScenario(scenario)
      await page.reload()
      await waitForDashboardLoaded(page)

      await test.step('los tres aparecen en "Requiere atención"', async () => {
        const noRecord = alertCard(page, data.employeeNoRecord.lastName)
        await expect(noRecord).toHaveCount(1)
        await expect(noRecord).toContainText('no registró el inicio')
        await expect(noRecord).toContainText(data.siteNoRecord.name)

        const absence = alertCard(page, data.employeeAbsence.lastName)
        await expect(absence).toHaveCount(1)
        await expect(absence).toContainText('avisó que no va')

        const uncovered = alertCard(page, data.siteUncovered.name)
        await expect(uncovered).toHaveCount(1)
        await expect(uncovered).toContainText('Turno sin cubrir')

        // El turno de la ausencia no se duplica como "sin cubrir" (decisión de `tablero.md`).
        await expect(alertCard(page, data.siteAbsence.name)).toHaveCount(1)
      })

      await test.step('los KPIs los cuentan', async () => {
        const after = await readKpis(page)
        expect(after.shifts).toBe(before.shifts + 3)
        expect(after.clients).toBe(before.clients + 1)
        expect(after.sites).toBe(before.sites + 3)
        expect(after.noRecord).toBe(before.noRecord + 1)
        expect(after.absences).toBe(before.absences + 1)
        expect(after.notices).toBe(before.notices + 1)
        expect(after.present).toBe(before.present)
      })

      await test.step('"Servicios de hoy" lista las dos asignaciones', async () => {
        await expect(
          servicesSection(page)
            .getByRole('row')
            .filter({ hasText: data.employeeNoRecord.lastName }),
        ).toHaveCount(1)
        await expect(
          servicesSection(page)
            .getByRole('row')
            .filter({ hasText: data.employeeAbsence.lastName }),
        ).toHaveCount(1)
      })

      await test.step('"Abrir turno" navega a ADM-06', async () => {
        await alertCard(page, data.siteUncovered.name)
          .getByRole('link', { name: 'Abrir turno' })
          .click()
        await expect(page).toHaveURL(
          new RegExp(`/admin/turnos/${data.shiftUncoveredId}$`),
        )
        await expect(
          page.getByText(data.siteUncovered.name).first(),
        ).toBeVisible()
        await page.goBack()
        await waitForDashboardLoaded(page)
      })

      await test.step('"Registrar en nombre" abre el panel; al registrar el inicio el tablero se actualiza solo', async () => {
        // Marca en `window`: si algo recargara la página, se perdería.
        await page.evaluate(() => {
          ;(window as unknown as { __e2eNoReload: boolean }).__e2eNoReload =
            true
        })
        const noRecord = alertCard(page, data.employeeNoRecord.lastName)
        await noRecord
          .getByRole('button', { name: 'Registrar en nombre' })
          .click()
        await expect(page.getByText('Registrar en nombre de')).toBeVisible()
        await page
          .getByLabel('Motivo')
          .fill('E2E-P162: avisó por teléfono que ya había llegado')
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(page.getByText('Registramos el inicio.')).toBeVisible()

        // La alerta de "sin registro" desaparece sin recargar. Como la franja 00:00–00:01 ya
        // terminó, la asignación pasa a "en curso pasada su hora de fin": es la alerta que
        // corresponde según `tablero.md` (la categoría 2 de "Requiere atención").
        await expect(noRecord).toHaveCount(1)
        await expect(noRecord).not.toContainText('no registró el inicio')
        await expect(noRecord).toContainText(
          'sigue en curso pasada su hora de fin',
        )
        await expectKpiValue(page, 'Sin registro', before.noRecord)
        await expectKpiValue(page, 'Presentes', before.present + 1)
        expect(
          await page.evaluate(
            () =>
              (window as unknown as { __e2eNoReload?: boolean }).__e2eNoReload,
          ),
        ).toBe(true)
      })
    } finally {
      await scenario.cleanup()
    }
  })

  test('RB-A07: en escritorio se muestran todas las alertas y no hay botón "Ver las N"', async ({
    page,
  }) => {
    const scenario = new TableroScenario()
    try {
      const data = await buildManyAlertsScenario(scenario)
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
      await waitForDashboardLoaded(page)

      const total = Number(
        await attentionSection(page).locator('h2 + span').innerText(),
      )
      // Con los datos propios ya hay más de 5 (los de otras suites del día se suman).
      expect(total).toBeGreaterThanOrEqual(data.alertCount)
      await expect(attentionSection(page).getByRole('listitem')).toHaveCount(
        total,
      )
      await expect(
        attentionSection(page).getByRole('button', { name: /^Ver las/ }),
      ).toHaveCount(0)
      await expect(
        attentionSection(page).getByRole('button', { name: 'Ver menos' }),
      ).toHaveCount(0)
    } finally {
      await scenario.cleanup()
    }
  })

  test('RB-A07 / matriz de permisos (03 sección 6): un administrador sin manage_attendance no ve "Registrar en nombre" ni asignar después del inicio', async ({
    page,
  }) => {
    const scenario = new TableroScenario()
    try {
      const data = await buildCoreScenario(scenario)
      const limitedAdmin = await scenario.createAdminWithout('sinasistencia', [
        'manage_attendance',
      ])
      await loginAs(page, limitedAdmin.email, limitedAdmin.password, /\/admin$/)
      await waitForDashboardLoaded(page)

      // El tablero se ve y trae las alertas (el administrador puede leer turnos y asignaciones).
      await expect(alertCard(page, data.employeeNoRecord.lastName)).toHaveCount(
        1,
      )
      await expect(alertCard(page, data.siteUncovered.name)).toHaveCount(1)
      // "Abrir turno" sigue disponible; lo que exige la capacidad no.
      await expect(
        alertCard(page, data.employeeNoRecord.lastName).getByRole('link', {
          name: 'Abrir turno',
        }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Registrar en nombre' }),
      ).toHaveCount(0)
      // `06` sección 8: asignar después del inicio del turno exige además manage_attendance.
      await expect(
        page.getByRole('button', { name: /^Asignar (reemplazo|empleado)/ }),
      ).toHaveCount(0)
    } finally {
      await scenario.cleanup()
    }
  })

  test('RB-A07: el dueño sí ve "Registrar en nombre" y "Asignar" (control positivo del permiso)', async ({
    page,
  }) => {
    const scenario = new TableroScenario()
    try {
      const data = await buildCoreScenario(scenario)
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
      await waitForDashboardLoaded(page)
      const noRecord = alertCard(page, data.employeeNoRecord.lastName)
      await expect(
        noRecord.getByRole('button', { name: 'Registrar en nombre' }),
      ).toBeVisible()
      await expect(
        noRecord.getByRole('button', { name: 'Asignar reemplazo' }),
      ).toBeVisible()
      await expect(
        alertCard(page, data.siteUncovered.name).getByRole('button', {
          name: 'Asignar empleado',
        }),
      ).toBeVisible()
    } finally {
      await scenario.cleanup()
    }
  })

  test('RB-A07: un empleado no puede entrar a /admin', async ({ page }) => {
    await loginAs(page, SEED_ACCOUNTS.employees[0], env!.seedPassword, /\/app/)
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/app/)
    await expect(
      page.getByRole('heading', { name: 'Requiere atención' }),
    ).toHaveCount(0)
  })

  test('RB-A07: un supervisor no puede entrar a /admin', async ({ page }) => {
    await loginAs(
      page,
      SEED_ACCOUNTS.supervisors[0],
      env!.seedPassword,
      /\/sup/,
    )
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/sup/)
    await expect(
      page.getByRole('heading', { name: 'Requiere atención' }),
    ).toHaveCount(0)
  })
})
