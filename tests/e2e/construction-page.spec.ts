import { expect, test } from '@playwright/test'

test('la portada muestra "Plataforma en construcción"', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('Plataforma en construcción')).toBeVisible()
})
