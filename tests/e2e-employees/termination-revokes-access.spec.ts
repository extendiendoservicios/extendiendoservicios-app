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
import { loginAs, loginAsExpectingFailure } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// EMP-014/TEST-006 (08_Fases_y_Backlog.md F9, encargo P09.5, punto 4): "baja desde la ficha
// ('Dar de baja') → la persona ya no puede entrar" (EMP-005, baja en dos pasos: Edge
// `deactivate_user` + `employees.status = 'terminated'`).

const env = readE2eEmployeesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('EMP-014: dar de baja a un empleado revoca el acceso', () => {
  test('después de "Dar de baja" la persona no puede iniciar sesión', async ({
    page,
  }) => {
    const admin = getAdminClient()
    const email = disposableEmail('baja')
    const password = `${env!.seedPassword}Aa1`
    const lastName = disposableLastName('Baja')
    let profileId: string | null = null

    try {
      await test.step('el dueño da de alta a un empleado', async () => {
        await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
        await createEmployeeViaForm(page, {
          firstName: 'E2E',
          lastName,
          dni: disposableDni(),
          email,
          password,
          isEmployeeRole: true,
          isSupervisorRole: false,
        })
        profileId = await findProfileIdByEmail(admin, email)
        expect(
          profileId,
          `no encontramos la cuenta recién creada (${email})`,
        ).toBeTruthy()
      })

      await test.step('primero puede iniciar sesión con normalidad', async () => {
        const context = await page
          .context()
          .browser()!
          .newContext(
            page.viewportSize() ? { viewport: page.viewportSize()! } : {},
          )
        const employeePage = await context.newPage()
        try {
          await loginAs(employeePage, email, password, /\/app$/)
        } finally {
          await context.close()
        }
      })

      await test.step('el dueño la da de baja desde la ficha con un motivo', async () => {
        // Ya está en la ficha (createEmployeeViaForm espera esa URL).
        await page.getByRole('button', { name: 'Dar de baja' }).click()
        await expect(
          page.getByRole('heading', { name: 'Dar de baja' }),
        ).toBeVisible()
        await page.getByLabel('Motivo').fill('E2E P095: fin de la prueba')
        await page.getByRole('button', { name: 'Dar de baja' }).last().click()
        await expect(
          page.getByText(`Dimos de baja a E2E ${lastName}.`),
        ).toBeVisible()
        // `exact: true`: sin esto, "Baja" también matchea el botón "Dar de baja" que sigue en
        // el DOM del diálogo mientras se cierra.
        await expect(page.getByText('Baja', { exact: true })).toBeVisible()
      })

      await test.step('ya no puede iniciar sesión', async () => {
        const context = await page
          .context()
          .browser()!
          .newContext(
            page.viewportSize() ? { viewport: page.viewportSize()! } : {},
          )
        const employeePage = await context.newPage()
        try {
          await loginAsExpectingFailure(employeePage, email, password)
        } finally {
          await context.close()
        }
      })
    } finally {
      // Ya quedó de baja por la propia acción probada: solo confirma el estado, sin volver a
      // banear (`terminateEmployeeDirectly` es idempotente igual, por si el paso de la
      // interfaz falló a mitad de camino).
      if (profileId) {
        await terminateEmployeeDirectly(admin, profileId)
      }
    }
  })
})
