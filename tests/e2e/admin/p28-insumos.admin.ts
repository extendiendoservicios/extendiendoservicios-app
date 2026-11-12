import { expect, test } from '@playwright/test'
import { getAdminDb } from '../../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { InsumosE2e } from '../../fixtures/stock.ts'
import { elegirSelect } from '../../fixtures/stock-ui.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P28.7: Insumos de las observaciones del 11 nov 2026.
//   - OF-01: el alta de un artículo arranca con costo y venta en 0 y se puede guardar sin tocarlos.
//   - OF-14: un administrador sin «Gestionar stock» ve un aviso que le dice qué pedir.
// Todo lo que se crea lleva el prefijo `e2e-p28i-` y se purga al final.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const ins = new InsumosE2e('p28i')

test.afterAll(async () => {
  const notas = await ins.purgar()
  if (notas.length > 0) console.warn(`[p28 insumos] ${notas.join(' | ')}`)
})

test.describe('OF-01: precios en 0 al dar de alta un artículo', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'el formulario arranca con costo y venta en 0 y el artículo se guarda sin cargar precios',
    cubre('OF-01', 'IS-02', 'RB-A04'),
    async ({ page }) => {
      const categoria = await ins.categoria('alta0')
      const codigo = `${ins.prefijo}cero-${Date.now().toString(36)}`
      const nombre = `${ins.prefijo}Sin precio ${Date.now().toString(36)}`

      await page.goto('/admin/insumos/nuevo')
      await expect(
        page.getByRole('button', { name: 'Cargar artículo' }),
      ).toBeVisible()

      await test.step('costo y venta arrancan en 0', async () => {
        await expect(page.getByLabel(/Precio de costo/)).toHaveValue('0')
        await expect(page.getByLabel(/Precio de venta/)).toHaveValue('0')
      })

      await test.step('el artículo se guarda con los precios vaciados (vacío = 0)', async () => {
        await page.getByLabel('Código interno').fill(codigo)
        await elegirSelect(page, 'Categoría', categoria.name)
        await page.getByLabel('Artículo', { exact: true }).fill(nombre)
        await page.getByLabel(/Precio de costo/).fill('')
        await page.getByLabel(/Precio de venta/).fill('')
        await page.getByRole('button', { name: 'Cargar artículo' }).click()
        await expect(page).toHaveURL(/\/admin\/insumos\/[0-9a-f-]{36}$/)
      })

      await test.step('en la base quedó con costo 0 y venta 0', async () => {
        const id = page.url().split('/').pop() ?? ''
        const { data } = await getAdminDb()
          .from('supplies')
          .select('cost_price, sale_price')
          .eq('id', id)
          .single()
        expect(Number(data?.cost_price)).toBe(0)
        expect(Number(data?.sale_price)).toBe(0)
      })
    },
  )

  test(
    'el formulario no tiene scroll horizontal a 390 px (OF-01, RESP-004)',
    cubre('OF-01', 'RB-X01'),
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/admin/insumos/nuevo')
      await expect(page.getByLabel(/Precio de costo/)).toHaveValue('0')
      await expectNoHorizontalScroll(page)
    },
  )
})

test.describe('OF-14: aviso al administrador sin «Gestionar stock»', () => {
  test.use({ storageState: storageStatePath('adminSinCapacidades') })

  test(
    'el aviso dice que pida la capacidad a la dirección, en escritorio y en celular',
    cubre('OF-14', 'IS-21', 'CB-17'),
    async ({ page }) => {
      await page.goto('/admin/insumos')
      const aviso = page.getByRole('note')
      await expect(aviso).toContainText(
        'Para cargar o modificar insumos, pedile a la dirección la capacidad Gestionar stock.',
      )
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(aviso).toBeVisible()
      await expectNoHorizontalScroll(page)
    },
  )
})

test.describe('OF-14: el administrador con la capacidad no ve el aviso', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'sin aviso con manage_stock',
    cubre('OF-14', 'IS-21'),
    async ({ page }) => {
      await page.goto('/admin/insumos')
      await expect(
        page.getByRole('tab', { name: 'Stock', selected: true }),
      ).toBeVisible()
      await expect(page.getByRole('note')).toHaveCount(0)
    },
  )
})
