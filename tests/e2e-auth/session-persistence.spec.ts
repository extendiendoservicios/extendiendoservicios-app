import { expect, test } from '@playwright/test'
import { readE2eAuthEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// AUTH-012: "persistencia de sesión (recarga y pestaña nueva)". Cuenta del seed en solo lectura.
const env = readE2eAuthEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test('la sesión sobrevive a recargar la página', async ({ page }) => {
  await page.goto('/ingresar')
  await page.getByLabel('Email').fill(SEED_ACCOUNTS.employees[0])
  await page.getByLabel('Contraseña', { exact: true }).fill(env!.seedPassword)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await page.reload()

  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByText('EMP-03')).toBeVisible()
})

test('la sesión sigue disponible en una pestaña nueva del mismo contexto', async ({
  page,
  context,
}) => {
  await page.goto('/ingresar')
  await page.getByLabel('Email').fill(SEED_ACCOUNTS.employees[0])
  await page.getByLabel('Contraseña', { exact: true }).fill(env!.seedPassword)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(/\/app$/)

  // `persistSession: true` (src/lib/supabase.ts) guarda la sesión en `localStorage`, que
  // comparte el mismo origen entre pestañas de un mismo contexto de navegador — no hace falta
  // volver a loguearse.
  const segundaPestana = await context.newPage()
  await segundaPestana.goto('/app')

  await expect(segundaPestana).toHaveURL(/\/app$/)
  await expect(segundaPestana.getByText('EMP-03')).toBeVisible()

  await segundaPestana.close()
})
