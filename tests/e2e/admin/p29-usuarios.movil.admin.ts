import { expect, test } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'
import {
  contador,
  esperarListado,
  ficha,
  numeros,
  URL_USUARIOS,
} from './p29-usuarios-pasos.ts'

// P29.6 (P29.4: OG-12), celular 390 px táctil (proyecto `mobile`): en el celular el listado de
// Usuarios son tarjetas sin encabezados, así que el orden se elige en un desplegable «Ordenar por».
// Sin scroll horizontal en ninguno de los estados. Cuenta: `admin`; no se crea ni se borra nada.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.describe('OG-12 · Usuarios en el celular (390 px)', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'las tarjetas muestran el legajo, el buscador filtra por DNI, el desplegable ordena y los filtros quedan en la dirección',
    cubre('RB-A01', 'RB-X01', 'OG-12'),
    async ({ page }) => {
      const { legajo, dni } = await ficha('empleado4')
      await page.goto(URL_USUARIOS)
      await esperarListado(page)
      await expectNoHorizontalScroll(page)
      const inicial = await numeros(page)

      await test.step('el buscador filtra por DNI y la tarjeta trae el legajo', async () => {
        await page.getByRole('searchbox', { name: 'Buscar usuarios' }).fill(dni)
        await expect(contador(page)).toHaveText(
          `1 de ${inicial.total} usuarios`,
        )
        const tarjeta = page.locator('dl').filter({ hasText: 'Legajo' })
        await expect(tarjeta).toHaveCount(1)
        await expect(tarjeta).toContainText(String(legajo))
        await expect(
          page.getByRole('link', { name: new RegExp(nombreDe('empleado4')) }),
        ).toBeVisible()
        await expectNoHorizontalScroll(page)
      })

      await test.step('sin resultados: mensaje vacío', async () => {
        await page
          .getByRole('searchbox', { name: 'Buscar usuarios' })
          .fill('zzz-nadie-e2e')
        await expect(
          page.getByText('No hay usuarios con esos filtros'),
        ).toBeVisible()
        await page.getByRole('searchbox', { name: 'Buscar usuarios' }).fill('')
        await expect(contador(page)).toHaveText(
          `${inicial.visibles} de ${inicial.total} usuarios`,
        )
      })

      await test.step('el desplegable «Ordenar por» cambia el orden y lo deja en la dirección', async () => {
        await page.getByRole('combobox', { name: 'Ordenar por' }).click()
        await page.getByRole('option', { name: 'Nombre' }).click()
        await expect(page).toHaveURL(/orden=nombre/)
        await page.getByRole('button', { name: 'Orden ascendente' }).click()
        await expect(page).toHaveURL(/dir=desc/)
        await expect(
          page.getByRole('button', { name: 'Orden descendente' }),
        ).toBeVisible()
        await expectNoHorizontalScroll(page)
      })

      await test.step('los filtros de rol y estado se ven, se pueden tocar con el dedo y se recuerdan al recargar', async () => {
        const rol = page
          .getByRole('group', { name: 'Filtrar por rol' })
          .getByRole('button', { name: 'Coordinación' })
        await rol.click()
        await expect(rol).toHaveAttribute('aria-pressed', 'true')
        await expect(page).toHaveURL(/roles=supervisor/)
        const caja = await rol.boundingBox()
        // Área táctil de al menos 44 px de alto (07_Design_System.md, RESP-008).
        expect(caja?.height ?? 0).toBeGreaterThanOrEqual(43.5)
        await page.reload()
        await esperarListado(page)
        await expect(
          page
            .getByRole('group', { name: 'Filtrar por rol' })
            .getByRole('button', { name: 'Coordinación' }),
        ).toHaveAttribute('aria-pressed', 'true')
        await expectNoHorizontalScroll(page)
      })
    },
  )
})
