import { expect, test } from '@playwright/test'
import { getAdminDb, type FixedAccountKey } from '../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'
import { leerNombre, reponerNombre } from './helpers/nombres.ts'

// P19.5d · AJ-01: Mi perfil (COM-04) a 390 px. El empleado y el supervisor cambian su propio
// nombre; el formulario es de una columna en el celular y la cabecera (`Hola, <nombre>` y el
// enlace «Mi perfil, <nombre>») se actualiza sin recargar. Repone el nombre al terminar.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const CASOS: Array<{ cuenta: FixedAccountKey; inicio: string; rol: string }> = [
  { cuenta: 'empleado1', inicio: '/app', rol: 'empleado' },
  { cuenta: 'supervisor1', inicio: '/sup', rol: 'supervisor' },
]

for (const { cuenta, inicio, rol } of CASOS) {
  test.describe(`Mi perfil del ${rol} en el celular (AJ-01)`, () => {
    test.use({ storageState: storageStatePath(cuenta) })

    test(
      `el ${rol} cambia su propio nombre y la cabecera se actualiza`,
      cubre('RB-E01', 'RB-X02'),
      async ({ page }) => {
        const original = await leerNombre(readId(cuenta))
        const nuevo = {
          nombre: `${original.firstName}-ed`,
          apellido: `${original.lastName}-ed`,
        }
        const desde = new Date().toISOString()
        try {
          await page.goto(inicio)
          await expect(
            page.getByText(`Hola, ${original.firstName}`),
          ).toBeVisible()
          await page.getByRole('link', { name: /Mi perfil/ }).click()
          await expect(page).toHaveURL(/\/perfil$/)

          const nombre = page.locator('#profile-first-name')
          const apellido = page.locator('#profile-last-name')
          await expect(nombre).toHaveValue(original.firstName)
          // Una sola columna a 390 px: el apellido queda debajo del nombre, no al costado.
          const cajaNombre = await nombre.boundingBox()
          const cajaApellido = await apellido.boundingBox()
          expect(cajaNombre).not.toBeNull()
          expect(cajaApellido).not.toBeNull()
          expect(cajaApellido!.y).toBeGreaterThan(cajaNombre!.y + 20)
          expect(Math.abs(cajaApellido!.x - cajaNombre!.x)).toBeLessThan(2)
          await expectNoHorizontalScroll(page)

          await nombre.fill(nuevo.nombre)
          await apellido.fill(nuevo.apellido)
          await page.getByRole('button', { name: 'Guardar nombre' }).click()
          await expect(page.getByText('Guardamos tu nombre.')).toBeVisible()

          // Vuelve por el historial (sin recargar): la cabecera ya trae el nombre nuevo.
          await page.goBack()
          await expect(page).toHaveURL(new RegExp(`${inicio}$`))
          await expect(page.getByText(`Hola, ${nuevo.nombre}`)).toBeVisible()
          await expect(
            page.getByRole('link', {
              name: `Mi perfil, ${nuevo.nombre} ${nuevo.apellido}`,
            }),
          ).toBeVisible()

          const guardado = await leerNombre(original.id)
          expect(guardado.firstName).toBe(nuevo.nombre)
          expect(guardado.lastName).toBe(nuevo.apellido)
          const { data: eventos } = await getAdminDb()
            .from('security_events')
            .select('actor_id, details')
            .eq('event_type', 'name_changed')
            .eq('target_id', original.id)
            .gte('created_at', desde)
          expect(eventos, 'un evento «Nombre modificado»').toHaveLength(1)
          expect(eventos?.[0]?.actor_id).toBe(original.id)
        } finally {
          await reponerNombre(original)
          await getAdminDb()
            .from('security_events')
            .delete()
            .eq('event_type', 'name_changed')
            .eq('target_id', original.id)
            .gte('created_at', desde)
        }
        expect(await leerNombre(original.id)).toEqual(original)
      },
    )
  })
}
