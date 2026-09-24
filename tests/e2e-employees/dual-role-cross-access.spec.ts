import { expect, test } from '@playwright/test'
import { readE2eEmployeesEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  disposableDni,
  disposableEmail,
  disposableLastName,
  findProfileIdByEmail,
  getAdminClient,
  terminateEmployeeDirectly,
} from './helpers/adminEmployeesClient.ts'
import { createEmployeeViaForm } from './helpers/employeeForm.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// EMP-014/TEST-006 (08_Fases_y_Backlog.md F9, encargo P09.5, punto 3): "persona con ambos roles
// (Editar roles de ADM-17, pestaña Datos) ve el acceso cruzado en Más (EMP-13 ↔ SUP-09)".
//
// LIMITACIÓN (ver el reporte del encargo): `EMP-13` y `SUP-09` todavía son pantallas placeholder
// ("Pantalla en construcción", `src/app/routes/employeeRoutes.tsx` / `supervisorRoutes.tsx`, `src/
// app/routes/placeholder.tsx`) -- no existe todavía el enlace cruzado en sí ("Supervisión" desde
// Más de empleado, "Mis servicios" desde Más de supervisor) que el criterio de F9 describe. Esta
// suite comprueba lo que SÍ es verificable hoy con lo que hay construido: que una persona con
// ambos roles puede navegar tanto a `/app` como a `/sup` (RequireRole no se lo impide, homePath-
// ForRoles la lleva a `/app` primero por prioridad de empleado) y que una persona con un solo rol
// NO puede entrar a la vía del otro (la redirige a la suya, nunca a `/sin-acceso`). El contenido
// real de Más queda pendiente de un e2e propio cuando EMP-13/SUP-09 se implementen (ver el
// reporte).
const env = readE2eEmployeesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('EMP-014: persona con ambos roles (empleado y supervisor)', () => {
  test('entra a /app y también puede navegar a /sup; un solo rol queda confinado al suyo', async ({
    page,
    browser,
  }) => {
    const admin = getAdminClient()
    const password = `${env!.seedPassword}Aa1`

    const dualEmail = disposableEmail('doble-rol')
    const dualLastName = disposableLastName('DobleRol')
    let dualProfileId: string | null = null

    const supervisorOnlyEmail = disposableEmail('solo-sup')
    const supervisorOnlyLastName = disposableLastName('SoloSupervisor')
    let supervisorOnlyProfileId: string | null = null

    try {
      await test.step('el dueño da de alta a un empleado y le agrega el rol de supervisor desde la ficha', async () => {
        await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
        await createEmployeeViaForm(page, {
          firstName: 'E2E',
          lastName: dualLastName,
          dni: disposableDni(),
          email: dualEmail,
          password,
          isEmployeeRole: true,
          isSupervisorRole: false,
        })
        dualProfileId = await findProfileIdByEmail(admin, dualEmail)
        expect(
          dualProfileId,
          'no encontramos la cuenta de doble rol recién creada',
        ).toBeTruthy()

        // Ya está en la ficha (createEmployeeViaForm espera esa URL): "Editar roles" vive en la
        // pestaña Datos, que es la que se ve por omisión.
        await page.getByRole('button', { name: 'Editar roles' }).click()
        await expect(
          page.getByRole('heading', { name: 'Editar roles' }),
        ).toBeVisible()
        await page.getByRole('checkbox', { name: 'Supervisor' }).click()
        await page.getByRole('button', { name: 'Guardar roles' }).click()
        await expect(
          page.getByText(`Actualizamos los roles de E2E ${dualLastName}.`),
        ).toBeVisible()
      })

      await test.step('esa persona inicia sesión, entra a /app y también puede navegar a /sup', async () => {
        const context = await browser.newContext(
          page.viewportSize() ? { viewport: page.viewportSize()! } : {},
        )
        const dualPage = await context.newPage()
        try {
          await loginAs(dualPage, dualEmail, password, /\/app$/)
          await dualPage.goto('/sup')
          await expect(dualPage).toHaveURL(/\/sup$/)
          await dualPage.goto('/app')
          await expect(dualPage).toHaveURL(/\/app$/)
        } finally {
          await context.close()
        }
      })

      await test.step('el dueño da de alta a un supervisor sin rol de empleado', async () => {
        await page.goto('/admin/empleados/nuevo')
        await createEmployeeViaForm(page, {
          firstName: 'E2E',
          lastName: supervisorOnlyLastName,
          dni: disposableDni(),
          email: supervisorOnlyEmail,
          password,
          isEmployeeRole: false,
          isSupervisorRole: true,
        })
        supervisorOnlyProfileId = await findProfileIdByEmail(
          admin,
          supervisorOnlyEmail,
        )
        expect(
          supervisorOnlyProfileId,
          'no encontramos la cuenta de solo supervisor recién creada',
        ).toBeTruthy()
      })

      await test.step('esa persona (solo supervisor) que intenta entrar a /app termina redirigida a /sup', async () => {
        const context = await browser.newContext(
          page.viewportSize() ? { viewport: page.viewportSize()! } : {},
        )
        const supervisorOnlyPage = await context.newPage()
        try {
          await loginAs(
            supervisorOnlyPage,
            supervisorOnlyEmail,
            password,
            /\/sup$/,
          )
          await supervisorOnlyPage.goto('/app')
          await expect(supervisorOnlyPage).toHaveURL(/\/sup$/)
        } finally {
          await context.close()
        }
      })
    } finally {
      if (dualProfileId) {
        await terminateEmployeeDirectly(admin, dualProfileId)
      }
      if (supervisorOnlyProfileId) {
        await terminateEmployeeDirectly(admin, supervisorOnlyProfileId)
      }
    }
  })
})
