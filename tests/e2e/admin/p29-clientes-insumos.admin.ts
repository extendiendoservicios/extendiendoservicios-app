import { expect, test } from '@playwright/test'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario, uniqueName } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { InsumosE2e } from '../../fixtures/stock.ts'
import { buscarEnStock } from '../../fixtures/stock-ui.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P29.6 (P29.4: OG-04 y OG-11), escritorio y celular:
//   - OG-04: un CUIT repetido muestra el aviso «¿Guardar igual?» y deja guardar; el buscador general
//     encuentra a los clientes que comparten el CUIT.
//   - OG-11: un administrador sin «Gestionar stock» ve deshabilitados los botones de Insumos, con la
//     explicación (el servidor sigue rechazando: IS-21).
// Los clientes llevan el prefijo `e2e-`; los datos de Insumos, `e2e-p29-` (se purgan al final).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const HINT = 'Necesitás el permiso «Gestionar stock». Pedíselo a la dirección.'

test.describe('OG-04 · CUIT repetido: se avisa y se puede guardar', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'el alta con un CUIT que ya tiene otro cliente avisa, «Volver» no guarda y «Guardar igual» crea el cliente; en la edición no se avisa contra sí mismo',
    cubre('RB-A02', 'OG-04'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const existente = await sc.client('og04')
        const { data: fila } = await sc.db
          .from('clients')
          .select('cuit')
          .eq('id', existente.id)
          .single()
        const cuit = fila?.cuit ?? ''
        expect(cuit).toMatch(/^\d{11}$/)
        const nombreNuevo = uniqueName('og04-bis')

        await page.goto('/admin/clientes/nuevo')
        await page.getByLabel('Razón social').fill(nombreNuevo)
        await page.getByLabel('CUIT').fill(cuit)

        await test.step('el aviso nombra al otro cliente y no bloquea', async () => {
          await page.getByRole('button', { name: 'Crear cliente' }).click()
          const aviso = page.getByRole('dialog', { name: 'CUIT repetido' })
          await expect(aviso).toContainText(
            `Ya hay otro cliente con este CUIT: ${existente.name}. ¿Guardar igual?`,
          )
          await expect(
            aviso.getByRole('button', { name: 'Guardar igual' }),
          ).toBeVisible()
        })

        await test.step('«Volver» no guarda nada y deja el formulario como estaba', async () => {
          await page
            .getByRole('dialog', { name: 'CUIT repetido' })
            .getByRole('button', { name: 'Volver' })
            .click()
          await expect(
            page.getByRole('dialog', { name: 'CUIT repetido' }),
          ).toHaveCount(0)
          await expect(page).toHaveURL(/\/admin\/clientes\/nuevo$/)
          await expect(page.getByLabel('Razón social')).toHaveValue(nombreNuevo)
          const { data } = await sc.db
            .from('clients')
            .select('id')
            .eq('legal_name', nombreNuevo)
          expect(data).toEqual([])
        })

        let nuevoId = ''
        await test.step('«Guardar igual» crea el cliente con el CUIT repetido', async () => {
          await page.getByRole('button', { name: 'Crear cliente' }).click()
          await page
            .getByRole('dialog', { name: 'CUIT repetido' })
            .getByRole('button', { name: 'Guardar igual' })
            .click()
          await expect(page).toHaveURL(/\/admin\/clientes\/[0-9a-f-]{36}$/)
          nuevoId = page.url().split('/').pop() ?? ''
          sc.clientIds.push(nuevoId)
          const { data } = await sc.db
            .from('clients')
            .select('id')
            .eq('cuit', cuit)
          expect(data?.map((c) => c.id).sort()).toEqual(
            [existente.id, nuevoId].sort(),
          )
        })

        await test.step('el buscador general encuentra a los dos clientes que comparten el CUIT', async () => {
          await page.goto('/admin')
          await page.getByRole('button', { name: /^Buscar/ }).click()
          await page
            .getByPlaceholder('Buscar empleados, clientes o sedes…')
            .fill(cuit)
          await expect(
            page.getByRole('option', { name: new RegExp(existente.name) }),
          ).toBeVisible()
          await expect(
            page.getByRole('option', { name: new RegExp(nombreNuevo) }),
          ).toBeVisible()
          await page.keyboard.press('Escape')
        })

        await test.step('al editar, el aviso nombra solo al otro cliente (no a sí mismo)', async () => {
          await page.goto(`/admin/clientes/${nuevoId}/editar`)
          // La ficha muestra el CUIT con guiones (20-12345678-6).
          await expect(page.getByLabel('CUIT')).toHaveValue(
            `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`,
          )
          await page.getByRole('button', { name: 'Guardar cambios' }).click()
          const aviso = page.getByRole('dialog', { name: 'CUIT repetido' })
          await expect(aviso).toContainText(
            `Ya hay otro cliente con este CUIT: ${existente.name}. ¿Guardar igual?`,
          )
          await expect(aviso).not.toContainText(nombreNuevo)
          await aviso.getByRole('button', { name: 'Guardar igual' }).click()
          await expect(page).not.toHaveURL(/\/editar$/)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'un CUIT que no usa nadie se guarda sin ningún aviso',
    cubre('RB-A02', 'OG-04'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const nombre = uniqueName('og04-unico')
        // CUIT propio de esta corrida: ningún otro cliente lo tiene.
        const cuit = `20${`${Date.now()}`.slice(-8)}7`
        await page.goto('/admin/clientes/nuevo')
        await page.getByLabel('Razón social').fill(nombre)
        await page.getByLabel('CUIT').fill(cuit)
        await page.getByRole('button', { name: 'Crear cliente' }).click()
        await expect(page).toHaveURL(/\/admin\/clientes\/[0-9a-f-]{36}$/)
        sc.clientIds.push(page.url().split('/').pop() ?? '')
        await expect(
          page.getByRole('dialog', { name: 'CUIT repetido' }),
        ).toHaveCount(0)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('OG-11 · Insumos sin «Gestionar stock»: botones deshabilitados con la explicación', () => {
  const ins = new InsumosE2e('p29')

  test.afterAll(async () => {
    const notas = await ins.purgar()
    if (notas.length > 0) console.warn(`[p29 insumos] ${notas.join(' | ')}`)
  })

  test.describe('administración sin la capacidad', () => {
    test.use({ storageState: storageStatePath('adminSinCapacidades') })

    test(
      'Ingreso, Retiro en nombre de, Cargar control, Ajustar y Anular se ven deshabilitados y la explicación está a la vista y en el tooltip',
      cubre('RB-A09', 'IS-21', 'CB-17', 'OG-11'),
      async ({ page }) => {
        test.setTimeout(240_000)
        try {
          const articulo = await ins.insumo({ slug: 'og11', stock: 3 })

          await page.goto('/admin/insumos')
          await expect(
            page.getByRole('tab', { name: 'Stock', selected: true }),
          ).toBeVisible()
          await buscarEnStock(page, articulo.code)

          await test.step('la explicación está siempre visible (también donde no hay tooltip)', async () => {
            await expect(page.getByRole('note')).toHaveText(HINT)
          })

          await test.step('los tres botones de la barra y «Ajustar» están deshabilitados y no son enlaces', async () => {
            for (const nombre of [
              'Ingreso',
              'Retiro en nombre de',
              'Cargar control',
            ]) {
              const boton = page.getByRole('button', { name: nombre })
              await expect(boton).toBeDisabled()
              await expect(boton).toHaveAttribute('title', HINT)
              await expect(
                page.getByRole('link', { name: nombre }),
              ).toHaveCount(0)
            }
            const ajustar = page.getByRole('button', {
              name: new RegExp(`^Ajustar el stock de ${articulo.name}`),
            })
            await expect(ajustar).toBeDisabled()
            // Un clic forzado sobre un botón deshabilitado no abre nada.
            await ajustar.click({ force: true })
            await expect(page.getByRole('dialog')).toHaveCount(0)
          })

          await test.step('el tooltip del botón explica qué permiso falta', async () => {
            await page
              .getByRole('button', { name: 'Ingreso' })
              .locator('xpath=..')
              .hover()
            await expect(page.getByRole('tooltip')).toContainText(HINT)
          })

          await test.step('Controles: «Cargar control» deshabilitado; Movimientos: «Anular» deshabilitado', async () => {
            await page.goto('/admin/insumos?pestana=controles')
            await expect(
              page.getByRole('button', { name: 'Cargar control' }),
            ).toBeDisabled()
            await page.goto('/admin/insumos?pestana=movimientos')
            await expect(
              page.getByTestId('movement-card').first(),
            ).toBeVisible()
            await expect(
              page
                .getByRole('button', { name: /^Anular /, disabled: true })
                .first(),
            ).toBeVisible()
            await expect(
              page.getByRole('button', { name: /^Anular /, disabled: false }),
            ).toHaveCount(0)
          })

          await test.step('entrando por la dirección, el servidor sigue diciendo que falta el permiso', async () => {
            await page.goto('/admin/insumos/ingreso')
            await expect(page.getByText(/No tenés permiso para/)).toBeVisible()
          })
        } finally {
          const notas = await ins.purgar()
          if (notas.length > 0)
            console.warn(`[p29 insumos] ${notas.join(' | ')}`)
        }
      },
    )

    test(
      'en el celular (390 px) los botones quedan deshabilitados y la explicación se lee sin tooltip',
      cubre('RB-A09', 'IS-21', 'OG-11'),
      async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto('/admin/insumos')
        await expect(
          page.getByRole('tab', { name: 'Stock', selected: true }),
        ).toBeVisible()
        await expect(page.getByRole('note')).toBeVisible()
        await expect(page.getByRole('note')).toHaveText(HINT)
        for (const nombre of [
          'Ingreso',
          'Retiro en nombre de',
          'Cargar control',
        ]) {
          await expect(
            page.getByRole('button', { name: nombre }),
          ).toBeDisabled()
        }
        await expectNoHorizontalScroll(page)
      },
    )
  })

  test.describe('administración con la capacidad', () => {
    test.use({ storageState: storageStatePath('admin') })

    test(
      'con «Gestionar stock» los mismos botones son enlaces habilitados y no hay explicación',
      cubre('RB-A09', 'IS-21', 'OG-11'),
      async ({ page }) => {
        await page.goto('/admin/insumos')
        await expect(
          page.getByRole('tab', { name: 'Stock', selected: true }),
        ).toBeVisible()
        for (const nombre of [
          'Ingreso',
          'Retiro en nombre de',
          'Cargar control',
          'Nuevo artículo',
        ]) {
          await expect(page.getByRole('link', { name: nombre })).toBeEnabled()
        }
        await expect(page.getByRole('note')).toHaveCount(0)
      },
    )
  })
})
