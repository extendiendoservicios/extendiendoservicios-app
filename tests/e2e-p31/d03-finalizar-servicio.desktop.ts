import { expect, test, type Page } from '@playwright/test'
import { daysFromToday } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { servicioActivo } from '../fixtures/p31.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'

// P31.6 · D-03 (OI-01, causa B): al finalizar o pausar un servicio, la dirección ve la casilla
// «Eliminar los turnos de este servicio desde [mañana]», marcada por defecto: elimina los turnos
// futuros SIN historia y deja los que tienen historia (se informa cuántos). Un administrador no la
// ve: ve el aviso «Quedan N turnos futuros. La dirección puede eliminarlos.» y no se borra nada
// (OD-22). Escritorio 1280 px. Sin cuentas de empleado: solo los turnos del escenario.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const FRANJA = { start: '08:00', end: '10:00' }

/**
 * Servicio activo con un turno de hoy (no se toca: la limpieza es «desde mañana»), tres turnos
 * futuros sin historia y uno con historia (un fichaje cargado a mano en un turno de mañana+3).
 */
async function armar(sc: Scenario, slug: string) {
  const base = await servicioActivo(sc, slug, FRANJA)
  const turno = (fecha: string) =>
    sc.shift(base.cliente.id, base.sede.id, fecha, FRANJA, 1, {
      serviceId: base.servicio.id,
    })
  const hoy = await turno(daysFromToday(0))
  const futuros = [
    await turno(daysFromToday(1)),
    await turno(daysFromToday(2)),
    await turno(daysFromToday(3)),
  ]
  const conHistoria = await turno(daysFromToday(4))
  const asignacion = await sc.assign(conHistoria, 'empleado4')
  const { error } = await sc.db.from('attendance_records').insert({
    assignment_id: asignacion,
    kind: 'check_in',
    recorded_at: `${daysFromToday(4)}T08:00:00-03:00`,
    source: 'admin',
    reason: 'e2e-historia',
  })
  expect(error, error?.message).toBeNull()
  return { ...base, hoy, futuros, conHistoria }
}

async function turnosVivos(sc: Scenario, servicioId: string) {
  const { data, error } = await sc.db
    .from('shifts')
    .select('id')
    .eq('service_id', servicioId)
    .is('deleted_at', null)
  expect(error, error?.message).toBeNull()
  return (data ?? []).map((t) => t.id).sort()
}

async function estadoDelServicio(sc: Scenario, servicioId: string) {
  const { data } = await sc.db
    .from('services')
    .select('status')
    .eq('id', servicioId)
    .single()
  return data?.status
}

async function abrirCambioDeEstado(
  page: Page,
  clienteId: string,
  servicio: string,
  estado: 'Pausado' | 'Finalizado',
) {
  await page.goto(`/admin/clientes/${clienteId}?pestana=servicios`)
  await page.getByRole('button', { name: `Acciones para ${servicio}` }).click()
  await page.getByRole('menuitem', { name: 'Cambiar estado' }).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toContainText(`Cambiar estado de "${servicio}"`)
  await dialogo.getByRole('combobox', { name: 'Estado nuevo' }).click()
  await page.getByRole('option', { name: estado }).click()
  return dialogo
}

test.describe('finalizar o pausar un servicio ofrece eliminar sus turnos (D-03)', () => {
  test.describe('dueño', () => {
    test.use({ storageState: storageStatePath('owner') })

    test(
      'finalizar con la casilla marcada por defecto elimina los turnos futuros sin historia y avisa del que queda',
      cubre('RB-A05', 'OI-01', 'D-03', 'OD-22', 'CB-14'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          const s = await armar(sc, 'd03-fin')
          const dialogo = await abrirCambioDeEstado(
            page,
            s.cliente.id,
            s.servicio.name,
            'Finalizado',
          )

          const casilla = dialogo.getByRole('checkbox', {
            name: /^Eliminar los turnos de este servicio desde /,
          })
          await expect(casilla).toBeChecked()
          await expect(
            dialogo.getByText('se eliminan los turnos sin historia', {
              exact: false,
            }),
          ).toBeVisible()
          await dialogo.getByRole('button', { name: 'Cambiar estado' }).click()

          await expect(
            page.getByText('Cambiamos el estado del servicio.'),
          ).toBeVisible()
          await expect(
            page.getByText(
              'Eliminamos 3 turnos. Quedó 1 turno por tener historia.',
            ),
          ).toBeVisible()
          expect(await estadoDelServicio(sc, s.servicio.id)).toBe('ended')
          // Quedan el de hoy (la limpieza es desde mañana) y el que tiene historia.
          expect(await turnosVivos(sc, s.servicio.id)).toEqual(
            [s.hoy, s.conHistoria].sort(),
          )
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )

    test(
      'pausar con la casilla destildada no elimina nada: los turnos quedan como están',
      cubre('RB-A05', 'OI-01', 'D-03'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          const s = await armar(sc, 'd03-pau')
          const antes = await turnosVivos(sc, s.servicio.id)
          expect(antes).toHaveLength(5)
          const dialogo = await abrirCambioDeEstado(
            page,
            s.cliente.id,
            s.servicio.name,
            'Pausado',
          )
          const casilla = dialogo.getByRole('checkbox', {
            name: /^Eliminar los turnos de este servicio desde /,
          })
          await expect(casilla).toBeChecked()
          await casilla.click()
          await expect(casilla).not.toBeChecked()
          await dialogo.getByRole('button', { name: 'Cambiar estado' }).click()
          await expect(
            page.getByText('Cambiamos el estado del servicio.'),
          ).toBeVisible()
          await expect
            .poll(() => estadoDelServicio(sc, s.servicio.id))
            .toBe('paused')
          expect(await turnosVivos(sc, s.servicio.id)).toEqual(antes)
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )

    test(
      'pausar con la casilla marcada también elimina; al reactivar no se ofrece eliminar',
      cubre('RB-A05', 'OI-01', 'D-03'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          const s = await armar(sc, 'd03-pau2')
          const dialogo = await abrirCambioDeEstado(
            page,
            s.cliente.id,
            s.servicio.name,
            'Pausado',
          )
          await dialogo.getByRole('button', { name: 'Cambiar estado' }).click()
          await expect(
            page.getByText(
              'Eliminamos 3 turnos. Quedó 1 turno por tener historia.',
            ),
          ).toBeVisible()
          expect(await estadoDelServicio(sc, s.servicio.id)).toBe('paused')

          // Reactivar (estado «Activo»): no ofrece la casilla de eliminar.
          await page.goto(`/admin/clientes/${s.cliente.id}?pestana=servicios`)
          await page
            .getByRole('button', { name: `Acciones para ${s.servicio.name}` })
            .click()
          await page.getByRole('menuitem', { name: 'Cambiar estado' }).click()
          const reactivar = page.getByRole('dialog')
          await reactivar
            .getByRole('combobox', { name: 'Estado nuevo' })
            .click()
          await page.getByRole('option', { name: 'Activo' }).click()
          await expect(
            reactivar.getByRole('checkbox', {
              name: /^Eliminar los turnos de este servicio desde /,
            }),
          ).toHaveCount(0)
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })

  test.describe('administrador', () => {
    test.use({ storageState: storageStatePath('admin') })

    test(
      'finalizar muestra «Quedan N turnos futuros. La dirección puede eliminarlos.» y no borra ningún turno',
      cubre('RB-A05', 'RB-X02', 'OI-01', 'D-03', 'OD-22', 'CB-17'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          const s = await armar(sc, 'd03-adm')
          const antes = await turnosVivos(sc, s.servicio.id)
          const dialogo = await abrirCambioDeEstado(
            page,
            s.cliente.id,
            s.servicio.name,
            'Finalizado',
          )
          await expect(
            dialogo.getByRole('checkbox', {
              name: /^Eliminar los turnos de este servicio desde /,
            }),
          ).toHaveCount(0)
          // Desde mañana: tres sin historia y uno con historia.
          await expect(dialogo.getByRole('status')).toHaveText(
            'Quedan 4 turnos futuros. La dirección puede eliminarlos.',
          )
          await dialogo.getByRole('button', { name: 'Cambiar estado' }).click()
          await expect(
            page.getByText('Cambiamos el estado del servicio.'),
          ).toBeVisible()
          await expect
            .poll(() => estadoDelServicio(sc, s.servicio.id))
            .toBe('ended')
          expect(await turnosVivos(sc, s.servicio.id)).toEqual(antes)
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })
})
