// tests/e2e-shifts-services/helpers/login.ts — SERVICE-007/SHIFT-012/TEST-007 (P10.4)
//
// Login por interfaz contra una cuenta real de `App_dev` (COM-01), mismo patrón que
// `tests/e2e-clients-sites/helpers/login.ts`.

import { expect, type Page } from '@playwright/test'

export async function loginAs(
  page: Page,
  email: string,
  password: string,
  expectedHomePattern: RegExp,
): Promise<void> {
  await page.goto('/ingresar')
  await page.getByLabel('Email').fill(email)
  // `exact: true`: en esta pantalla `getByLabel('Contraseña')` también matchea el botón
  // "Mostrar contraseña" (mismo `aria-label` parcial) — sin `exact` Playwright tira
  // "strict mode violation" (encontrado armando esta suite, ver el reporte del encargo).
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(expectedHomePattern)
}
