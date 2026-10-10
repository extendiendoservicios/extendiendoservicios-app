import { expect, test, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readE2eEmployeesEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  disposableDni,
  disposableEmail,
  disposableLastName,
  findProfileIdByEmail,
  getAdminClient,
  terminateEmployeeDirectly,
} from './helpers/adminEmployeesClient.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../fixtures/seed-accounts.ts'

// Defecto del 9 oct 2026 en producción (0.16.4, migraciones 0035 y 0036): la ficha nacía con un
// legajo provisorio que chocaba con legajos cargados a mano; el alta fallaba como «DNI ya
// registrado» y dejaba la cuenta de Auth sin ficha ni roles («email ya en uso» al reintentar).
// Además, el teléfono del alta no se guardaba. Cada test entra como el dueño del seed y da de
// alta desde ADM-18.

const env = readE2eEmployeesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

/**
 * Legajo libre por debajo del más alto: así la prueba no sube el legajo que el formulario sugiere
 * (máximo + 1) para las altas reales de App_dev.
 */
async function disposableEmployeeNumber(
  admin: SupabaseClient,
): Promise<number> {
  const { data, error } = await admin
    .from('employees')
    .select('employee_number')
  expect(error).toBeNull()
  const used = new Set((data ?? []).map((row) => row.employee_number as number))
  const max = Math.max(0, ...used)
  const free: number[] = []
  for (let n = 1; n < max; n += 1) {
    if (!used.has(n)) free.push(n)
  }
  expect(
    free.length,
    'no hay legajos libres por debajo del máximo',
  ).toBeGreaterThan(0)
  return free[Math.floor(Math.random() * free.length)]
}

interface FormInput {
  firstName: string
  lastName: string
  dni: string
  email: string
  password: string
  employeeNumber: number
  phone?: string
}

async function fillAndSubmit(page: Page, input: FormInput): Promise<void> {
  await page.goto('/admin/empleados/nuevo')
  await page.locator('#employee-email').fill(input.email)
  await page.locator('#employee-password').fill(input.password)
  await page.locator('#employee-first-name').fill(input.firstName)
  await page.locator('#employee-last-name').fill(input.lastName)
  await page.locator('#employee-dni').fill(input.dni)
  if (input.phone) {
    await page.locator('#employee-phone').fill(input.phone)
  }
  await page.locator('#employee-number').fill(String(input.employeeNumber))
  await page.getByRole('button', { name: 'Crear' }).click()
}

async function expectCreated(page: Page, input: FormInput): Promise<void> {
  await expect(page).toHaveURL(/\/admin\/empleados\/(?!nuevo)[^/]+$/, {
    timeout: 20_000,
  })
  await expect(
    page.getByRole('heading', { name: `${input.firstName} ${input.lastName}` }),
  ).toBeVisible()
}

test.describe('0.16.4: altas sin cuentas a medias', () => {
  test('el alta guarda el legajo pedido y el teléfono', async ({ page }) => {
    const admin = getAdminClient()
    const input: FormInput = {
      firstName: 'E2E',
      lastName: disposableLastName('Telefono'),
      dni: disposableDni(),
      email: disposableEmail('telefono'),
      password: `${env!.seedPassword}Aa1`,
      employeeNumber: await disposableEmployeeNumber(admin),
      phone: '2477 123456',
    }
    let profileId: string | null = null
    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
      await fillAndSubmit(page, input)
      await expectCreated(page, input)

      profileId = await findProfileIdByEmail(admin, input.email)
      const { data: profile } = await admin
        .from('profiles')
        .select('phone')
        .eq('id', profileId!)
        .single()
      expect(profile?.phone).toBe('2477 123456')
      const { data: employee } = await admin
        .from('employees')
        .select('employee_number')
        .eq('profile_id', profileId!)
        .single()
      expect(employee?.employee_number).toBe(input.employeeNumber)
    } finally {
      const id = profileId ?? (await findProfileIdByEmail(admin, input.email))
      if (id) await terminateEmployeeDirectly(admin, id)
    }
  })

  test('legajo repetido: avisa de quién es, marca el campo y no crea la cuenta', async ({
    page,
  }) => {
    const admin = getAdminClient()
    const first: FormInput = {
      firstName: 'E2E',
      lastName: disposableLastName('LegajoUno'),
      dni: disposableDni(),
      email: disposableEmail('legajo-uno'),
      password: `${env!.seedPassword}Aa1`,
      employeeNumber: await disposableEmployeeNumber(admin),
    }
    const second: FormInput = {
      ...first,
      lastName: disposableLastName('LegajoDos'),
      dni: disposableDni(),
      email: disposableEmail('legajo-dos'),
    }
    let firstId: string | null = null
    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
      await fillAndSubmit(page, first)
      await expectCreated(page, first)
      firstId = await findProfileIdByEmail(admin, first.email)

      await fillAndSubmit(page, second)
      const message = `El legajo ${first.employeeNumber} ya es de E2E ${first.lastName}. Elegí otro.`
      await expect(
        page.locator('[data-slot="field-error"]', { hasText: message }),
      ).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('#employee-number')).toHaveAttribute(
        'aria-invalid',
        'true',
      )
      expect(await findProfileIdByEmail(admin, second.email)).toBeNull()
    } finally {
      const id = firstId ?? (await findProfileIdByEmail(admin, first.email))
      if (id) await terminateEmployeeDirectly(admin, id)
    }
  })

  test('una cuenta que quedó a medias se retoma con el mismo email', async ({
    page,
  }) => {
    const admin = getAdminClient()
    const input: FormInput = {
      firstName: 'E2E',
      lastName: disposableLastName('Retomada'),
      dni: disposableDni(),
      email: disposableEmail('retomada'),
      password: `${env!.seedPassword}Aa1`,
      employeeNumber: await disposableEmployeeNumber(admin),
    }
    // Lo que dejaba un alta fallida antes del arreglo: cuenta de Auth (y su perfil) sin roles
    // ni ficha.
    const { data: orphan, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: `${env!.seedPassword}Bb2`,
      email_confirm: true,
      user_metadata: { first_name: 'Primer', last_name: 'Intento' },
    })
    expect(error).toBeNull()
    const orphanId = orphan.user!.id
    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
      await fillAndSubmit(page, input)
      await expectCreated(page, input)
      // Es la misma cuenta, no una nueva.
      await expect(page).toHaveURL(new RegExp(`/admin/empleados/${orphanId}$`))

      const { count } = await admin
        .from('user_roles')
        .select('role', { count: 'exact', head: true })
        .eq('profile_id', orphanId)
        .eq('role', 'employee')
      expect(count).toBe(1)
    } finally {
      await terminateEmployeeDirectly(admin, orphanId)
    }
  })
})
