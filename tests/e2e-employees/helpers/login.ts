// tests/e2e-employees/helpers/login.ts — EMP-014/TEST-006 (P09.5)
//
// Login por interfaz contra una cuenta real de `App_dev` (COM-01), mismo patrón que
// `tests/e2e-clients-sites/helpers/login.ts`. `expectedHomePattern` deja elegir a qué URL tiene
// que llegar cada rol (`/admin` para dueño y administrador, `/app` para empleado, `/sup` para
// supervisor — `homePathForRoles`, `src/features/auth/session.ts`).

import { expect, type Page } from '@playwright/test'

/**
 * `exact: true`: sin esto, `getByLabel('Contraseña')` matchea DOS elementos en `LoginPage.tsx`
 * -- el campo de verdad (`FieldLabel` "Contraseña") y el botón de mostrar/ocultar de
 * `PasswordInput` (`aria-label="Mostrar contraseña"`, que contiene "Contraseña" como substring y
 * por eso también matchea la búsqueda por substring que usa `getByLabel` sin `exact`).
 * Encontrado corriendo esta suite contra `App_dev` (`locator.fill: strict mode violation:
 * getByLabel('Contraseña') resolved to 2 elements`) -- afecta a cualquier suite que use este
 * mismo selector sobre una pantalla con `PasswordInput`, ver el reporte del encargo P09.5.
 */
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

/**
 * Intento de login que se espera que NO llegue a ninguna vía (cuenta dada de baja o sin rol):
 * comprueba que sigue en `/ingresar` con el mensaje de error, en vez de asumir una URL de
 * destino como hace `loginAs`.
 */
export async function loginAsExpectingFailure(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/ingresar')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(/\/ingresar/)
}
