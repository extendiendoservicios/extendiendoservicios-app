// tests/e2e-employee-shift/helpers/login.ts — MOB-EMP-017 (P13.4)
//
// Login por interfaz contra una cuenta real de `App_dev` (COM-01), mismo patrón que
// `tests/e2e-checklists/helpers/login.ts` (copia deliberada, no un import cruzado).

import { expect, type Page } from '@playwright/test'

export async function loginAs(
  page: Page,
  email: string,
  password: string,
  expectedHomePattern: RegExp,
): Promise<void> {
  await page.goto('/ingresar')
  await page.getByLabel('Email').fill(email)
  // `exact: true`: sin esto, `getByLabel('Contraseña')` también matchea el botón "Mostrar
  // contraseña" de `PasswordInput` (mismo hallazgo que documentaron otras suites de esta capa).
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(expectedHomePattern)
}
