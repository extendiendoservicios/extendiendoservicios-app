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
        // Necesario acá (no solo en el `finally`): los dos pasos siguientes dependen de que la
        // persona YA esté de baja para comprobar el filtro. `terminateEmployeeDirectly` es
        // idempotente, así que el `finally` de abajo la vuelve a llamar igual, como red de
        // seguridad si algo fallara ANTES de esta línea (por ejemplo, no encontrar el
        // `profileId`) -- encontrado un profile activo sin dar de baja tras una corrida con un
        // fallo intermedio en esta misma suite, ver el reporte del encargo P09.5.
        await terminateEmployeeDirectly(admin, profileId!)
      })

      await test.step('con el filtro por omisión, no aparece en ADM-16', async () => {
        await page.goto('/admin/empleados')
        // `lastName` (no `fullName`): el buscador de ADM-16 filtra por `ilike` sobre
        // `first_name`/`last_name`/`dni` por separado (`fetchEmployees`, `src/api/
        // employees.ts`), no sobre el nombre completo concatenado -- con `fullName` ("E2E " +
        // apellido) no matchea ninguna de las dos columnas por separado y la búsqueda siempre
        // da cero filas, filtro de estado aparte (encontrado corriendo esta suite contra
        // `App_dev`, ver el reporte del encargo P09.5).
        await page
          .getByPlaceholder('Buscar por nombre, DNI o legajo…')
          .fill(lastName)
        // Por rol (no `getByText`): `PersonCell` repite el nombre en un `span.sr-only` además
        // del texto visible, así que `getByText(fullName)` resuelve dos elementos dentro del
        // mismo enlace -- encontrado corriendo esta suite tres veces seguidas contra `App_dev`
        // (pasaba la primera vez y fallaba la segunda por esta ambigüedad, ver el reporte del
        // encargo P09.5 y la regla TEST-029).
        await expect(page.getByRole('link', { name: fullName })).toHaveCount(0)
      })

      await test.step('al elegir el filtro "Baja", aparece', async () => {
        await page.getByLabel('Filtrar por estado').click()
        await page.getByRole('option', { name: 'Baja' }).click()
        await expect(page.getByRole('link', { name: fullName })).toBeVisible()
      })
    } finally {
      // Red de seguridad: `terminateEmployeeDirectly` ya se llamó en el primer paso (necesario
      // para el resto del test, ver el comentario de arriba), pero volver a llamarla acá es
      // idempotente y cubre el caso en que ese primer paso fallara antes de llegar a esa línea
      // (incluida la resolución por email si `profileId` quedó en `null` porque
      // `createEmployeeViaForm` lanzó DESPUÉS de crear la cuenta de verdad, ver el reporte del
      // encargo P09.5).
      const idToClean = profileId ?? (await findProfileIdByEmail(admin, email))
      if (idToClean) {
        await terminateEmployeeDirectly(admin, idToClean)
      }
    }
  })
})
