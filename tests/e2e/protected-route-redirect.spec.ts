import { expect, test } from '@playwright/test'

// DS-015: sin sesión (y esta suite corre contra el build de producción,
// donde no existe `/dev/rol` para simular una), cualquier ruta protegida
// redirige a `/ingresar` (COM-01) — nunca se abre.
test('una ruta protegida sin sesión termina en /ingresar', async ({ page }) => {
  await page.goto('/admin')

  await expect(page).toHaveURL(/\/ingresar$/)
  await expect(page.getByRole('heading', { name: 'Ingresar' })).toBeVisible()
})

test('/app y /sup sin sesión también terminan en /ingresar', async ({
  page,
}) => {
  await page.goto('/app')
  await expect(page).toHaveURL(/\/ingresar$/)

  await page.goto('/sup')
  await expect(page).toHaveURL(/\/ingresar$/)
})
