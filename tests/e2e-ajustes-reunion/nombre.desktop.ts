import { expect, test, type Page } from '@playwright/test'
import { getAdminDb, nombreDe } from '../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { chooseMenuItem } from '../fixtures/ui.ts'
import {
  leerNombre,
  reponerNombre,
  type NombreGuardado,
} from './helpers/nombres.ts'

// P19.5d · AJ-01 (reunión del 6 oct 2026): «Editar nombre».
//   - El dueño ve «Editar nombre» en Configuración → Usuarios y cambia el nombre de otra persona y
//     el suyo; queda un evento «Nombre modificado» en Eventos de seguridad.
//   - Un administrador (con todas las capacidades) no ve la opción.
//   - Cualquier persona cambia su propio nombre desde Mi perfil y la cabecera se actualiza (acá el
//     administrador, en escritorio; el empleado y el supervisor a 390 px, en `nombre.movil.ts`).
// Cada test repone los nombres que toca. Cuentas: empleado2 (nombre ajeno), admin y el dueño.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

/** Último evento `name_changed` sobre una persona, con los nombres que guardó (service_role). */
async function ultimoEventoDeNombre(targetId: string) {
  const { data, error } = await getAdminDb()
    .from('security_events')
    .select('actor_id, target_id, details, created_at')
    .eq('event_type', 'name_changed')
    .eq('target_id', targetId)
    .order('created_at', { ascending: false })
    .limit(1)
  expect(error, error?.message).toBeNull()
  return data?.[0]
}

async function editarNombreDesdeUsuarios(
  page: Page,
  nombreActual: string,
  nuevo: { nombre: string; apellido: string },
) {
  await chooseMenuItem(page, `Acciones para ${nombreActual}`, 'Editar nombre')
  const dialogo = page.getByRole('dialog', { name: 'Editar nombre' })
  await expect(dialogo).toBeVisible()
  await dialogo.getByLabel('Nombre', { exact: true }).fill(nuevo.nombre)
  await dialogo.getByLabel('Apellido', { exact: true }).fill(nuevo.apellido)
  await dialogo.getByRole('button', { name: 'Guardar nombre' }).click()
  await expect(
    page.getByText(`Cambiamos el nombre a ${nuevo.nombre} ${nuevo.apellido}.`),
  ).toBeVisible()
  await expect(dialogo).toHaveCount(0)
}

test.describe('el dueño edita nombres (AJ-01)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    've «Editar nombre», cambia el de otra persona y el suyo, y queda el evento «Nombre modificado»',
    cubre('RB-A01', 'RB-X02', 'P-103'),
    async ({ page }) => {
      const sufijo = Date.now().toString(36)
      const ajeno: NombreGuardado = await leerNombre(readId('empleado2'))
      const propio: NombreGuardado = await leerNombre(readId('owner'))
      const ajenoNuevo = {
        nombre: `${ajeno.firstName}-ed${sufijo}`,
        apellido: `${ajeno.lastName}-ed`,
      }
      const propioNuevo = {
        nombre: `${propio.firstName}-ed${sufijo}`,
        apellido: `${propio.lastName}-ed`,
      }
      const desde = new Date().toISOString()
      try {
        await page.goto('/admin/configuracion/usuarios')
        await expect(
          page.getByRole('heading', { name: 'Usuarios y roles' }),
        ).toBeVisible()

        await test.step('otra persona: abre el menú de la fila y ve «Editar nombre»', async () => {
          await page
            .getByRole('button', {
              name: `Acciones para ${nombreDe('empleado2')}`,
            })
            .click()
          await expect(
            page.getByRole('menuitem', { name: 'Editar nombre' }),
          ).toBeVisible()
          await page.keyboard.press('Escape')
          await editarNombreDesdeUsuarios(
            page,
            nombreDe('empleado2'),
            ajenoNuevo,
          )
          const guardado = await leerNombre(ajeno.id)
          expect(guardado.firstName).toBe(ajenoNuevo.nombre)
          expect(guardado.lastName).toBe(ajenoNuevo.apellido)
          // La lista ya muestra el nombre nuevo.
          await expect(
            page.getByRole('button', {
              name: `Acciones para ${ajenoNuevo.nombre} ${ajenoNuevo.apellido}`,
            }),
          ).toBeVisible()
        })

        await test.step('el suyo: el dueño también se edita a sí mismo', async () => {
          await editarNombreDesdeUsuarios(
            page,
            `${propio.firstName} ${propio.lastName}`,
            propioNuevo,
          )
          const guardado = await leerNombre(propio.id)
          expect(guardado.firstName).toBe(propioNuevo.nombre)
          expect(guardado.lastName).toBe(propioNuevo.apellido)
        })

        await test.step('el servidor dejó los eventos name_changed con el nombre anterior y el nuevo', async () => {
          const eventoAjeno = await ultimoEventoDeNombre(ajeno.id)
          expect(eventoAjeno?.actor_id).toBe(propio.id)
          expect(eventoAjeno?.details).toMatchObject({
            first_name_previous: ajeno.firstName,
            last_name_previous: ajeno.lastName,
            first_name_new: ajenoNuevo.nombre,
            last_name_new: ajenoNuevo.apellido,
          })
          const eventoPropio = await ultimoEventoDeNombre(propio.id)
          expect(eventoPropio?.actor_id).toBe(propio.id)
          expect(eventoPropio?.details).toMatchObject({
            first_name_previous: propio.firstName,
            first_name_new: propioNuevo.nombre,
          })
        })

        await test.step('ADM-31: «Nombre modificado» aparece en Eventos de seguridad', async () => {
          await page.goto('/admin/configuracion/seguridad')
          await page
            .getByRole('combobox', { name: 'Filtrar por tipo de evento' })
            .click()
          await page
            .getByRole('option', { name: 'Nombre modificado', exact: true })
            .click()
          const fila = page
            .getByRole('row')
            .filter({ hasText: 'Nombre modificado' })
            .filter({
              hasText: `${ajenoNuevo.nombre} ${ajenoNuevo.apellido}`,
            })
          await expect(fila.first()).toBeVisible()
          await expect(fila.first()).toContainText(
            `${propioNuevo.nombre} ${propioNuevo.apellido}`,
          )
        })
      } finally {
        await reponerNombre(ajeno)
        await reponerNombre(propio)
        // Los eventos de esta prueba son del propio test: se borran para no acumular auditoría
        // falsa en App_dev (si la base no deja borrar, quedan como rastro de la prueba).
        await getAdminDb()
          .from('security_events')
          .delete()
          .eq('event_type', 'name_changed')
          .in('target_id', [ajeno.id, propio.id])
          .gte('created_at', desde)
      }
      expect(await leerNombre(ajeno.id), 'nombre ajeno repuesto').toEqual(ajeno)
      expect(await leerNombre(propio.id), 'nombre del dueño repuesto').toEqual(
        propio,
      )
    },
  )
})

test.describe('un administrador no edita nombres ajenos (AJ-01)', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'el menú de una persona no ofrece «Editar nombre»',
    cubre('RB-A01', 'RB-X02', 'CB-17'),
    async ({ page }) => {
      await page.goto('/admin/configuracion/usuarios')
      await expect(
        page.getByRole('heading', { name: 'Usuarios y roles' }),
      ).toBeVisible()
      await page
        .getByRole('button', { name: `Acciones para ${nombreDe('empleado2')}` })
        .click()
      // El menú abierto sí trae las acciones que el administrador tiene...
      await expect(
        page.getByRole('menuitem', { name: 'Resetear contraseña' }),
      ).toBeVisible()
      // ...pero «Editar nombre» es solo del dueño.
      await expect(
        page.getByRole('menuitem', { name: 'Editar nombre' }),
      ).toHaveCount(0)
    },
  )
})

test.describe('Mi perfil en administración (AJ-01)', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'el administrador cambia su propio nombre y la cabecera se actualiza',
    cubre('RB-A01', 'RB-X02'),
    async ({ page }) => {
      const original = await leerNombre(readId('admin'))
      const nuevo = {
        nombre: `${original.firstName}-ed`,
        apellido: `${original.lastName}-ed`,
      }
      const desde = new Date().toISOString()
      try {
        await page.goto('/admin')
        await expect(
          page.getByRole('button', { name: /Menú de usuario/ }),
        ).toContainText(`${original.firstName} ${original.lastName}`)
        await page.getByRole('button', { name: /Menú de usuario/ }).click()
        await page.getByRole('menuitem', { name: 'Mi perfil' }).click()
        await expect(page).toHaveURL(/\/perfil$/)

        await page.locator('#profile-first-name').fill(nuevo.nombre)
        await page.locator('#profile-last-name').fill(nuevo.apellido)
        await page.getByRole('button', { name: 'Guardar nombre' }).click()
        await expect(page.getByText('Guardamos tu nombre.')).toBeVisible()

        // La cabecera cambia sin recargar la página.
        await expect(
          page.getByRole('button', { name: /Menú de usuario/ }),
        ).toContainText(`${nuevo.nombre} ${nuevo.apellido}`)
        const guardado = await leerNombre(original.id)
        expect(guardado.firstName).toBe(nuevo.nombre)
        expect(guardado.lastName).toBe(nuevo.apellido)
        const evento = await ultimoEventoDeNombre(original.id)
        expect(evento?.actor_id, 'quien cambió el nombre').toBe(original.id)
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

  test(
    'un nombre vacío o de más de 100 caracteres se rechaza antes de guardar',
    cubre('RB-A01'),
    async ({ page }) => {
      const original = await leerNombre(readId('admin'))
      await page.goto('/perfil')
      await page.locator('#profile-first-name').fill('')
      await page.getByRole('button', { name: 'Guardar nombre' }).click()
      await expect(page.locator('#profile-first-name')).toHaveAttribute(
        'aria-invalid',
        'true',
      )
      await page.locator('#profile-first-name').fill('x'.repeat(101))
      await page.getByRole('button', { name: 'Guardar nombre' }).click()
      await expect(page.locator('#profile-first-name')).toHaveAttribute(
        'aria-invalid',
        'true',
      )
      await expect(page.getByText('Guardamos tu nombre.')).toHaveCount(0)
      expect(await leerNombre(original.id)).toEqual(original)
    },
  )
})
