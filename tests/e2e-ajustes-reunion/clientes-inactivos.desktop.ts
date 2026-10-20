import { expect, test, type Page } from '@playwright/test'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'

// P19.11g · Clientes y sedes inactivos fuera de lo nuevo (P19.11d, punto 3 de la reunión del 19 oct).
// Un cliente suspendido o dado de baja no se ofrece en «Nuevo turno» ni en «Nuevo servicio»; una
// sede inactiva tampoco. En los listados (filtros) siguen apareciendo: acá solo se prueba lo nuevo.
// Cuenta: admin.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

const PANTALLAS = [
  { nombre: 'Nuevo turno', ruta: '/admin/turnos/nuevo' },
  { nombre: 'Nuevo servicio', ruta: '/admin/servicios/nuevo' },
] as const

async function abrirClientes(page: Page, ruta: string) {
  await page.goto(ruta)
  await page.getByRole('combobox', { name: 'Cliente' }).click()
}

for (const pantalla of PANTALLAS) {
  test(
    `${pantalla.nombre}: un cliente suspendido o dado de baja no se ofrece, y una sede inactiva tampoco`,
    cubre('RB-A02', 'RB-A03'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const activo = await sc.client('p1911-activo')
        const suspendido = await sc.client('p1911-suspendido', 'suspended')
        const baja = await sc.client('p1911-baja', 'closed')
        const sedeActiva = await sc.site(activo.id, 'p1911-sede-activa')
        const sedeInactiva = await sc.site(activo.id, 'p1911-sede-inactiva')
        const { error } = await sc.db
          .from('sites')
          .update({ status: 'inactive' })
          .eq('id', sedeInactiva.id)
        expect(error, error?.message).toBeNull()

        await abrirClientes(page, pantalla.ruta)
        // Primero el activo: sin esto, «no está» podría ser que la lista todavía no cargó.
        const opcionActiva = page.getByRole('option', { name: activo.name })
        await expect(opcionActiva).toBeVisible()
        await expect(
          page.getByRole('option', { name: suspendido.name }),
        ).toHaveCount(0)
        await expect(page.getByRole('option', { name: baja.name })).toHaveCount(
          0,
        )

        await test.step('la sede inactiva del cliente activo no se ofrece', async () => {
          await opcionActiva.click()
          await page.getByRole('combobox', { name: 'Sede' }).click()
          await expect(
            page.getByRole('option', { name: sedeActiva.name }),
          ).toBeVisible()
          await expect(
            page.getByRole('option', { name: sedeInactiva.name }),
          ).toHaveCount(0)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
}
