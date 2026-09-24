import { expect, test } from '@playwright/test'
import { readE2eEmployeesEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import { expectNoHorizontalScroll } from './helpers/noHorizontalScroll.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// EMP-014/TEST-006 (08_Fases_y_Backlog.md F9, encargo P09.5, punto 8): capturas a 390 px de
// ADM-16 (listado) y ADM-17 (ficha, con cada pestaña), cada una con la comprobación de que no
// haya scroll horizontal. Corre solo en el proyecto `mobile` (`playwright.employees.config.ts`).
//
// Usa una persona real del seed (Juan Pérez), no una descartable: esta suite solo LEE estas
// pantallas (sin crear ni modificar nada), así que no hace falta una precondición propia -- mismo
// criterio que `tests/e2e-clients-sites/mobile-screenshots.spec.ts` con sus clientes de control.
const SEED_EMPLOYEE_FULL_NAME = 'Juan Pérez'

const env = readE2eEmployeesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('TEST-006: capturas móviles (390 px) de ADM-16 y ADM-17', () => {
  test('ADM-16 (listado) sin scroll horizontal', async ({ page }, testInfo) => {
    await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
    await page.goto('/admin/empleados')
    await expect(page.getByRole('heading', { name: 'Empleados' })).toBeVisible()
    await expectNoHorizontalScroll(page)
    await page.screenshot({
      path: testInfo.outputPath('adm-16-empleados-390.png'),
      fullPage: true,
    })
  })

  test('ADM-17 (ficha, cada pestaña) sin scroll horizontal', async ({
    page,
  }, testInfo) => {
    await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
    await page.goto('/admin/empleados')
    // Filtra por nombre antes de buscar el enlace: evita depender de en qué página de la
    // paginación (20 por página) cae esta persona del seed.
    await page
      .getByPlaceholder('Buscar por nombre, DNI o legajo…')
      .fill(SEED_EMPLOYEE_FULL_NAME)
    await page
      .getByRole('link', { name: new RegExp(SEED_EMPLOYEE_FULL_NAME) })
      .click()
    await expect(page).toHaveURL(/\/admin\/empleados\/[^/]+$/)

    const tabs = [
      { value: 'datos', label: 'Datos' },
      { value: 'habilitaciones', label: 'Habilitaciones' },
      { value: 'disponibilidad', label: 'Disponibilidad' },
      { value: 'licencias', label: 'Licencias' },
      { value: 'proximos-turnos', label: 'Próximos turnos' },
      { value: 'asistencia', label: 'Asistencia' },
      { value: 'calificaciones', label: 'Calificaciones' },
    ] as const

    for (const tab of tabs) {
      await page.getByRole('tab', { name: tab.label }).click()
      await expectNoHorizontalScroll(page)
      await page.screenshot({
        path: testInfo.outputPath(`adm-17-ficha-${tab.value}-390.png`),
        fullPage: true,
      })
    }
  })
})
