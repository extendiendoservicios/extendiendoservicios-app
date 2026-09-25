// tests/e2e-clients-sites/helpers/login.ts — CLIENT-008/SITE-008/TEST-005 (P08.5)
//
// Login por interfaz contra una cuenta real de `App_dev` (COM-01), mismo patrón que
// `tests/e2e-users/owner-creates-admin-and-capabilities.spec.ts`. `expectedHomePattern` deja
// elegir a qué URL tiene que llegar cada rol (`/admin` para dueño y administrador, `/app` para
// empleado, `/sup` para supervisor — `homePathForRoles`, `src/features/auth/session.ts`).

import { expect, type Page } from '@playwright/test'

export async function loginAs(
  page: Page,
  email: string,
  password: string,
  expectedHomePattern: RegExp,
): Promise<void> {
  await page.goto('/ingresar')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(expectedHomePattern)
}
