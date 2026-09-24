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

// EMP-014/TEST-006 (08_Fases_y_Backlog.md F9, encargo P09.5, punto 5): "una licencia vigente
// hace que la cabecera muestre 'De licencia'; al darla de baja vuelve a 'Activo'. Una licencia
// superpuesta muestra el error 'ya tiene una licencia cargada que se superpone'" (EMP-008,
// `employee_leaves_no_overlap`).
//
// Fecha "desde" relativa a hoy en hora de Argentina (regla común "Independencia"): `app.today()`
// (`0011_views.sql`) calcula `effective_status` con `America/Argentina/Buenos_Aires`, así que
// una licencia que arranca "hoy" según esa zona siempre cuenta como vigente, sin importar la
// zona horaria de la máquina que corre la suite.

const env = readE2eEmployeesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

/** `YYYY-MM-DD` de "hoy" en la zona horaria del sistema (ADR-019: única zona, Argentina). */
function todayInArgentina(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  })
}

test.describe('EMP-014: licencias y el estado efectivo de la ficha', () => {
  test('licencia vigente → "De licencia"; superpuesta → error; dada de baja → "Activo"', async ({
    page,
  }) => {
    const admin = getAdminClient()
    const email = disposableEmail('licencia')
    const password = `${env!.seedPassword}Aa1`
    const lastName = disposableLastName('Licencia')
    let profileId: string | null = null
    const today = todayInArgentina()

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

      // Badge de estado efectivo de la cabecera (junto al nombre): se acota a ese contenedor
      // porque la pestaña Datos también muestra un segundo badge "Activo"/"Desactivado" para el
      // acceso de la cuenta (`StatusBadge domain="user"`, sección "Usuario y roles") -- sin
      // acotar, `getByText('Activo', { exact: true })` resuelve dos elementos cuando los dos
      // coinciden en texto (encontrado corriendo esta suite contra `App_dev`, ver el reporte del
      // encargo P09.5).
      const headerStatusBadge = page
        .getByRole('heading', { name: `E2E ${lastName}` })
        .locator('..')

      await test.step('una licencia vigente (desde hoy, sin fecha de fin) → cabecera "De licencia"', async () => {
        await page.getByRole('tab', { name: 'Licencias' }).click()
        await page.getByLabel('Desde').fill(today)
        await page
          .getByLabel('Motivo (opcional)')
          .fill('E2E P095: licencia vigente')
        await page.getByRole('button', { name: 'Agregar licencia' }).click()
        await expect(page.getByText('Agregamos la licencia.')).toBeVisible()
        // `exact: true`: sin esto, "Vigente" también matchea el motivo que se acaba de cargar
        // ("E2E P095: licencia vigente", substring case-insensitive) -- encontrado corriendo
        // esta suite contra `App_dev`, ver el reporte del encargo P09.5.
        await expect(page.getByText('Vigente', { exact: true })).toBeVisible()

        // El estado efectivo de la cabecera (`v_employees.effective_status`) depende de la misma
        // licencia: se comprueba en la pestaña Datos, no en Licencias.
        await page.getByRole('tab', { name: 'Datos' }).click()
        await expect(
          headerStatusBadge.getByText('De licencia', { exact: true }),
        ).toBeVisible()
      })

      await test.step('una segunda licencia que se superpone con la vigente se rechaza', async () => {
        await page.getByRole('tab', { name: 'Licencias' }).click()
        await page.getByLabel('Desde').fill(today)
        await page
          .getByLabel('Motivo (opcional)')
          .fill('E2E P095: se superpone')
        await page.getByRole('button', { name: 'Agregar licencia' }).click()
        await expect(
          page.getByText(
            'Esa persona ya tiene una licencia cargada que se superpone con esas fechas.',
          ),
        ).toBeVisible()
      })

      await test.step('al dar de baja la licencia vigente, la cabecera vuelve a "Activo"', async () => {
        // Sigue en la pestaña Licencias del paso anterior.
        await page
          .getByRole('listitem')
          .filter({ hasText: 'E2E P095: licencia vigente' })
          .getByRole('button', { name: 'Dar de baja' })
          .click()
        await expect(
          page.getByRole('heading', { name: 'Dar de baja esta licencia' }),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Dar de baja' }).last().click()
        await expect(page.getByText('Dimos de baja la licencia.')).toBeVisible()

        await page.getByRole('tab', { name: 'Datos' }).click()
        await expect(
          headerStatusBadge.getByText('Activo', { exact: true }),
        ).toBeVisible()
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
