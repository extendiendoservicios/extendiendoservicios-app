// tests/e2e-tablero/helpers/login.ts — DASH-008 (P16.2)
//
// Login por interfaz contra una cuenta real de `App_dev` (COM-01).

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
  // contraseña" de `PasswordInput`.
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(expectedHomePattern)
}
