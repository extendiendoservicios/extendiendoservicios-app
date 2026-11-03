import { expect, test } from '@playwright/test'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// P27.8 (OD-22, OD-23): borrado físico, SOLO del dueño, desde la interfaz (1280 px).
//   - El dueño elimina un turno sin historia (no pide escribir el nombre) y queda el evento
//     `record_deleted` en Eventos de seguridad.
//   - Intento de eliminar un cliente con sedes: el diálogo dice qué lo frena y no deja confirmar.
//   - El dueño elimina un cliente sin historia escribiendo el nombre: «Eliminar» queda
//     deshabilitado hasta que coincide.
//   - El administrador (aunque tenga todas las capacidades) no ve «Eliminar» en turno, cliente,
//     sede ni servicio.
// Los datos llevan el prefijo `e2e-` y fechas relativas a hoy; no dependen de la hora del día.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

/** El diálogo abierto (hay uno solo a la vez). */
const dialogo = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog')

test.describe('borrado del dueño (OD-22, OD-23)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'el dueño elimina un turno sin historia desde su detalle y queda el evento de seguridad',
    cubre('RB-A04', 'RB-A10', 'OD-22', 'OD-23', 'P-014'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const cliente = await sc.client('borra-turno')
        const sede = await sc.site(cliente.id, 'borra-turno')
        const fecha = new Date(`${sc.today}T12:00:00Z`)
        fecha.setUTCDate(fecha.getUTCDate() + 20)
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          fecha.toISOString().slice(0, 10),
          { start: '08:00', end: '12:00' },
        )
        const desde = new Date().toISOString()

        await page.goto(`/admin/turnos/${turno}`)
        await page.getByRole('button', { name: 'Eliminar turno' }).click()
        await expect(
          dialogo(page).getByRole('heading', { name: /^Eliminar el turno/ }),
        ).toBeVisible()
        await expect(dialogo(page)).toContainText('Es irreversible')
        await expect(dialogo(page)).toContainText('Se va a eliminar:')
        // El turno no pide escribir el nombre: se confirma directo.
        await expect(
          dialogo(page).getByRole('textbox'),
          'el turno no pide el nombre',
        ).toHaveCount(0)
        await dialogo(page).getByRole('button', { name: 'Eliminar' }).click()
        await expect(page.getByText(/Eliminamos el turno/)).toBeVisible()
        await expect(dialogo(page)).toHaveCount(0)

        const { data } = await sc.db.from('shifts').select('id').eq('id', turno)
        expect(data, 'el turno ya no existe').toHaveLength(0)
        const { data: eventos } = await sc.db
          .from('security_events')
          .select('actor_id, details')
          .eq('event_type', 'record_deleted')
          .gte('created_at', desde)
        expect(eventos?.length).toBeGreaterThanOrEqual(1)

        // ADM-31: el evento se ve en Eventos de seguridad, con la columna «Detalle».
        await page.goto('/admin/configuracion/seguridad')
        await expect(
          page.getByRole('columnheader', { name: 'Detalle' }),
        ).toBeVisible()
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'un cliente con sedes no se puede eliminar: el diálogo dice qué lo frena y no ofrece confirmar',
    cubre('RB-A03', 'OD-22', 'OD-23', 'P-014'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const cliente = await sc.client('borra-bloqueo')
        const sede = await sc.site(cliente.id, 'borra-bloqueo')

        await page.goto(`/admin/clientes/${cliente.id}`)
        await page
          .getByRole('button', { name: 'Eliminar', exact: true })
          .click()
        await expect(
          dialogo(page).getByRole('heading', { name: /^Eliminar el cliente/ }),
        ).toBeVisible()
        await expect(dialogo(page)).toContainText(
          'No se puede eliminar todavía.',
        )
        // El mensaje nombra lo que lo frena (OD-23: «Este cliente todavía tiene 1 sede»).
        await expect(dialogo(page)).toContainText(/todavía tiene 1 sede/i)
        await expect(
          dialogo(page).getByRole('button', { name: 'Eliminar' }),
          'con un bloqueo no se ofrece «Eliminar»',
        ).toHaveCount(0)
        await expect(dialogo(page).getByRole('textbox')).toHaveCount(0)
        await dialogo(page).getByRole('button', { name: 'Cancelar' }).click()

        const { data } = await sc.db
          .from('clients')
          .select('id')
          .eq('id', cliente.id)
        expect(data, 'el cliente sigue').toHaveLength(1)
        const sedes = await sc.db.from('sites').select('id').eq('id', sede.id)
        expect(sedes.data, 'la sede sigue').toHaveLength(1)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'el dueño elimina un cliente sin historia escribiendo su nombre; «Eliminar» espera a que coincida',
    cubre('RB-A03', 'OD-22', 'OD-23', 'P-014'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const cliente = await sc.client('borra-cliente')
        const desde = new Date().toISOString()

        await page.goto(`/admin/clientes/${cliente.id}`)
        await page
          .getByRole('button', { name: 'Eliminar', exact: true })
          .click()
        const d = dialogo(page)
        await expect(d).toContainText('Es irreversible')
        await expect(d).toContainText(
          `Para confirmar, escribí «${cliente.name}»`,
        )
        const confirmar = d.getByRole('button', {
          name: 'Eliminar',
          exact: true,
        })
        await expect(confirmar).toBeDisabled()
        await d.getByRole('textbox').fill('otro nombre')
        await expect(confirmar).toBeDisabled()
        await d.getByRole('textbox').fill(cliente.name)
        await expect(confirmar).toBeEnabled()
        await confirmar.click()

        await expect(page.getByText(/Eliminamos el cliente/)).toBeVisible()
        await expect(page).toHaveURL(/\/admin\/clientes(\?|$)/)
        const { data } = await sc.db
          .from('clients')
          .select('id')
          .eq('id', cliente.id)
        expect(data, 'el cliente ya no existe').toHaveLength(0)
        const { data: eventos } = await sc.db
          .from('security_events')
          .select('actor_id')
          .eq('event_type', 'record_deleted')
          .gte('created_at', desde)
        expect(eventos?.length).toBeGreaterThanOrEqual(1)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('el administrador no puede eliminar (OD-22, OD-22b)', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'el administrador con todas las capacidades no ve «Eliminar» en turno, cliente, sede ni servicio',
    cubre('RB-A03', 'RB-A04', 'OD-22', 'OD-22b', 'CB-17'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const cliente = await sc.client('admin-sin-eliminar')
        const sede = await sc.site(cliente.id, 'admin-sin-eliminar')
        const servicio = await sc.service(
          cliente.id,
          sede.id,
          'admin-sin-eliminar',
          { status: 'paused' },
        )
        const turno = await sc.shift(cliente.id, sede.id, sc.today, {
          start: '08:00',
          end: '12:00',
        })

        await page.goto(`/admin/turnos/${turno}`)
        // Espera a que la pantalla cargue (el administrador sí cancela y edita el turno).
        await expect(page.getByText(sede.name).first()).toBeVisible()
        await expect(
          page.getByRole('button', { name: /^Eliminar/ }),
        ).toHaveCount(0)

        await page.goto(`/admin/clientes/${cliente.id}`)
        await expect(
          page.getByRole('button', { name: 'Cambiar estado' }),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: /^Eliminar/ }),
        ).toHaveCount(0)

        await page.goto(`/admin/sedes/${sede.id}`)
        await expect(page.getByText(sede.name).first()).toBeVisible()
        await expect(
          page.getByRole('button', { name: /^Eliminar/ }),
        ).toHaveCount(0)

        // Servicios del cliente: el menú ofrece Editar y Cambiar estado, pero ni «Eliminar» ni
        // «Eliminar turnos sin historia…».
        await page.goto(`/admin/clientes/${cliente.id}?pestana=servicios`)
        await expect(page.getByText(servicio.name)).toBeVisible()
        await page
          .getByRole('button', { name: `Acciones para ${servicio.name}` })
          .click()
        await expect(
          page.getByRole('menuitem', { name: 'Cambiar estado' }),
        ).toBeVisible()
        await expect(
          page.getByRole('menuitem', { name: /Eliminar/ }),
        ).toHaveCount(0)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
