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

// EMP-014/TEST-006 (08_Fases_y_Backlog.md F9, encargo P09.5): "e2e: alta de empleado con
// usuario → ese usuario entra a /app; alta de supervisor → entra a /sup" (RB-A02). Cada test
// entra como el dueño del seed, da de alta desde ADM-18 (`/admin/empleados/nuevo`, EMP-003) y
// después inicia sesión como la persona recién creada en un contexto de navegador aparte, para
// comprobar a qué vía entra según su rol.

const env = readE2eEmployeesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('EMP-014: alta de empleado y de supervisor con usuario', () => {
  test('alta de empleado con usuario: ese usuario inicia sesión y entra a /app', async ({
    page,
    browser,
  }) => {
    const admin = getAdminClient()
    const email = disposableEmail('empleado')
    const password = `${env!.seedPassword}Aa1`
    const lastName = disposableLastName('Empleado')
    let profileId: string | null = null

    try {
      await test.step('el dueño da de alta a un empleado desde ADM-18', async () => {
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

      await test.step('esa persona inicia sesión y entra a /app', async () => {
        const context = await browser.newContext(
          page.viewportSize() ? { viewport: page.viewportSize()! } : {},
        )
        const employeePage = await context.newPage()
        try {
          await loginAs(employeePage, email, password, /\/app$/)
        } finally {
          await context.close()
        }
      })
    } finally {
      // Vuelve a resolver por email si `profileId` quedó en `null`: `createEmployeeViaForm`
      // puede lanzar DESPUÉS de que la cuenta ya se creó de verdad del lado del servidor (por
      // ejemplo, si el `Crear` tarda más de lo que esperan las aserciones de la interfaz) --
      // sin este resguardo, ese caso deja un huérfano sin dar de baja (encontrado corriendo
      // esta suite contra `App_dev`, ver el reporte del encargo P09.5).
      const idToClean = profileId ?? (await findProfileIdByEmail(admin, email))
      if (idToClean) {
        await terminateEmployeeDirectly(admin, idToClean)
      }
    }
  })

  test('alta de supervisor con usuario: ese usuario inicia sesión y entra a /sup', async ({
    page,
    browser,
  }) => {
    const admin = getAdminClient()
    const email = disposableEmail('supervisor')
    const password = `${env!.seedPassword}Aa1`
    const lastName = disposableLastName('Supervisor')
    let profileId: string | null = null

    try {
      await test.step('el dueño da de alta a un supervisor desde ADM-18', async () => {
        await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
        await createEmployeeViaForm(page, {
          firstName: 'E2E',
          lastName,
          dni: disposableDni(),
          email,
          password,
          isEmployeeRole: false,
          isSupervisorRole: true,
        })
        profileId = await findProfileIdByEmail(admin, email)
        expect(
          profileId,
          `no encontramos la cuenta recién creada (${email})`,
        ).toBeTruthy()
      })

      await test.step('esa persona inicia sesión y entra a /sup', async () => {
        const context = await browser.newContext(
          page.viewportSize() ? { viewport: page.viewportSize()! } : {},
        )
        const supervisorPage = await context.newPage()
        try {
          await loginAs(supervisorPage, email, password, /\/sup$/)
        } finally {
          await context.close()
        }
      })
    } finally {
      const idToClean = profileId ?? (await findProfileIdByEmail(admin, email))
      if (idToClean) {
        await terminateEmployeeDirectly(admin, idToClean)
      }
    }
  })
})
