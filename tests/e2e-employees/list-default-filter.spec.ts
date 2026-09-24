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

// EMP-014/TEST-006 (08_Fases_y_Backlog.md F9, encargo P09.5, punto 6): ADM-16 (`/admin/
// empleados`) filtra por omisión "Activos y de licencia" (decisión de Mike del 24 sep 2026,
// `EmployeesPage.tsx`) y no muestra dados de baja; al elegir "Dados de baja" (la etiqueta real
// es "Baja", `getStatusMeta`) aparecen.

const env = readE2eEmployeesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('ADM-16: el filtro de estado por omisión no muestra dados de baja', () => {
  test('activos y de licencia por omisión; "Baja" solo aparece al elegirlo', async ({
    page,
  }) => {
    const admin = getAdminClient()
    const email = disposableEmail('filtro')
    const password = `${env!.seedPassword}Aa1`
    const lastName = disposableLastName('Filtro')
    const fullName = `E2E ${lastName}`
    let profileId: string | null = null

    try {
      await test.step('el dueño da de alta a un empleado y lo da de baja directo (precondición)', async () => {
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
        await terminateEmployeeDirectly(admin, profileId!)
      })

      await test.step('con el filtro por omisión, no aparece en ADM-16', async () => {
        await page.goto('/admin/empleados')
        await page
          .getByPlaceholder('Buscar por nombre, DNI o legajo…')
          .fill(fullName)
        await expect(page.getByText(fullName)).toHaveCount(0)
      })

      await test.step('al elegir el filtro "Baja", aparece', async () => {
        await page.getByLabel('Filtrar por estado').click()
        await page.getByRole('option', { name: 'Baja' }).click()
        await expect(page.getByText(fullName)).toBeVisible()
      })
    } finally {
      // Ya quedó de baja como precondición del propio test: nada más que limpiar.
    }
  })
})
