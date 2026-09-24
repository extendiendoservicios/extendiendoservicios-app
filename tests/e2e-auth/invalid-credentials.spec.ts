import { expect, test } from '@playwright/test'
import { readE2eAuthEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// AUTH-012: "credenciales erróneas (mensaje de error en español, sin revelar si el email
// existe)". `authErrors.ts` (loginErrorMessage) unifica el texto de `invalid_credentials` para
// los dos casos — acá se comprueba desde la pantalla, no solo leyendo el código.
const env = readE2eAuthEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

const MENSAJE_ESPERADO = 'El email o la contraseña no son correctos.'

async function intentarIngresar(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
) {
  await page.goto('/ingresar')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page.getByText('No pudimos iniciar sesión')).toBeVisible()
  return page.getByText(MENSAJE_ESPERADO)
}

test('contraseña incorrecta para una cuenta real muestra el mensaje genérico', async ({
  page,
}) => {
  const mensaje = await intentarIngresar(
    page,
    SEED_ACCOUNTS.employees[0],
    'contraseña-a-proposito-incorrecta-000',
  )
  await expect(mensaje).toBeVisible()
  // Sigue en /ingresar: no entró.
  await expect(page).toHaveURL(/\/ingresar$/)
})

test('un email que no existe muestra EXACTAMENTE el mismo mensaje (no delata la cuenta)', async ({
  page,
}) => {
  const mensaje = await intentarIngresar(
    page,
    `e2e-auth-inexistente-${Date.now()}@example.com`,
    'cualquier-contraseña-12345',
  )
  await expect(mensaje).toBeVisible()
  await expect(page).toHaveURL(/\/ingresar$/)
})
