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

// EMP-014/TEST-006 (08_Fases_y_Backlog.md F9, encargo P09.5, punto 7): el buscador global
// (EMP-012, GlobalSearch en la topbar de AdminShell) encuentra a un empleado por nombre, legajo
// y DNI.

const env = readE2eEmployeesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('EMP-012: el buscador global encuentra a un empleado', () => {
  test('por nombre, legajo y DNI', async ({ page }) => {
    const admin = getAdminClient()
    const email = disposableEmail('buscador')
    const password = `${env!.seedPassword}Aa1`
    const lastName = disposableLastName('Buscador')
    const fullName = `E2E ${lastName}`
    const dni = disposableDni()
    let profileId: string | null = null

    try {
      await test.step('el dueño da de alta a un empleado', async () => {
        await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
        await createEmployeeViaForm(page, {
          firstName: 'E2E',
          lastName,
          dni,
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

      // El legajo real lo asigna la secuencia del servidor: se lee del subtítulo de la fila de
      // resultado ("Legajo NNN", `v_search`), no de un valor fijo de antemano.
      let employeeNumberLabel = ''

      await test.step('por nombre', async () => {
        await page.goto('/admin')
        await page.getByRole('button', { name: /^Buscar/ }).click()
        await page
          .getByPlaceholder('Buscar empleados, clientes o sedes…')
          .fill(fullName)
        const result = page.getByRole('option', { name: new RegExp(fullName) })
        await expect(result).toBeVisible()
        employeeNumberLabel = (await result.textContent()) ?? ''
        expect(employeeNumberLabel).toMatch(/Legajo \d+/)
        await page.keyboard.press('Escape')
      })

      await test.step('por legajo', async () => {
        const legajoMatch = employeeNumberLabel.match(/Legajo (\d+)/)
        expect(
          legajoMatch,
          'no pudimos leer el legajo del resultado anterior',
        ).toBeTruthy()
        const legajo = legajoMatch![1]

        await page.getByRole('button', { name: /^Buscar/ }).click()
        await page
          .getByPlaceholder('Buscar empleados, clientes o sedes…')
          .fill(legajo)
        await expect(
          page.getByRole('option', { name: new RegExp(fullName) }),
        ).toBeVisible()
        await page.keyboard.press('Escape')
      })

      await test.step('por DNI', async () => {
        await page.getByRole('button', { name: /^Buscar/ }).click()
        await page
          .getByPlaceholder('Buscar empleados, clientes o sedes…')
          .fill(dni)
        await expect(
          page.getByRole('option', { name: new RegExp(fullName) }),
        ).toBeVisible()
        await page.keyboard.press('Escape')
      })
    } finally {
      // Vuelve a resolver por email si quedó en `null`: `createEmployeeViaForm` puede lanzar
      // DESPUÉS de que la cuenta ya se creó de verdad del lado del servidor -- sin este
      // resguardo, ese caso deja un huérfano sin dar de baja (encontrado corriendo esta suite
      // contra `App_dev`, ver el reporte del encargo P09.5).
      const idToClean = profileId ?? (await findProfileIdByEmail(admin, email))
      if (idToClean) {
        await terminateEmployeeDirectly(admin, idToClean)
      }
    }
  })
})
