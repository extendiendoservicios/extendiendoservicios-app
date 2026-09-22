import { expect, test } from '@playwright/test'

/**
 * AUTH-004 (P06.3): `/` ya no muestra la portada "Plataforma en
 * construcción" (borrada junto con `ConstructionPage`, ver el reporte del
 * encargo) — redirige según sesión y rol (`05_Pantallas_y_Navegacion.md`
 * sección 5). Sin sesión, cae en COM-01 (`/ingresar`).
 */
test('sin sesión, "/" redirige a la pantalla de ingreso (COM-01)', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/ingresar$/)
  await expect(page.getByRole('heading', { name: 'Ingresar' })).toBeVisible()
})
