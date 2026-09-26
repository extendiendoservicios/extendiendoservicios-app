// tests/e2e-checklists/helpers/login.ts — TASK-008 (P12.3)
//
// Login por interfaz contra una cuenta real de `App_dev` (COM-01), mismo patrón que
// `tests/e2e-assignments/helpers/login.ts`.

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
  // "strict mode violation" (defecto ya reportado por otras suites de esta carpeta).
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(expectedHomePattern)
}
