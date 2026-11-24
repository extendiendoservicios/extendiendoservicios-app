import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { abrirCalendario, bloqueDe, fechaDeMes } from '../fixtures/p30.ts'
import { agregarFijo, fechaPasada, servicioActivo } from '../fixtures/p31.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import {
  cargarJornada,
  finalizarTurno,
} from '../e2e-ajustes-reunion/helpers/historial.ts'

// P31.6 · D-06 (OI-04) y D-02: «Eliminar turno» en el ⋮ de la tarjeta del calendario del empleado,
// en la tarjeta punteada (fijo sin asignar) y en Calendario › Día. Solo la dirección (OD-22): un
// administrador no lo ve. Con historia (fichajes) el diálogo no deja confirmar. Escritorio 1280 px.
// Cuentas de este archivo: empleado3 y empleado4 (cada test usa una).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

// Mes futuro (día 3 a 24); base propia para no pisarse con los demás archivos.
const BASE = fechaDeMes(50)

async function turnoExiste(sc: Scenario, id: string): Promise<boolean> {
  const { data } = await sc.db
    .from('shifts')
    .select('id, deleted_at')
    .eq('id', id)
    .maybeSingle()
  return data != null && data.deleted_at == null
}

/** Abre el menú ⋮ del bloque del turno en el calendario del empleado. */
async function abrirMenuDelBloque(page: Page, sede: string) {
  const bloque = bloqueDe(page, sede)
  await expect(bloque).toBeVisible()
  await bloque.getByRole('button', { name: /^Opciones del turno de / }).click()
}

test.describe('el dueño elimina turnos desde los calendarios (D-06)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'menú ⋮ del calendario del empleado: «Eliminar turno» pide confirmación y borra el turno',
    cubre('RB-A04', 'OI-04', 'D-06', 'OD-22'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('d06-menu')
        const sede = await sc.site(cliente.id, 'd06-menu')
        const turno = await sc.shift(cliente.id, sede.id, BASE, {
          start: '08:00',
          end: '10:00',
        })
        await sc.assign(turno, 'empleado3')

        await abrirCalendario(page, 'empleado3', BASE)
        await abrirMenuDelBloque(page, sede.name)
        await page.getByRole('menuitem', { name: 'Eliminar turno' }).click()

        const dialogo = page.getByRole('dialog')
        await expect(
          dialogo.getByRole('heading', { name: /^Eliminar el turno/ }),
        ).toBeVisible()
        await expect(dialogo).toContainText('Es irreversible')
        // Cancelar no borra nada.
        await dialogo.getByRole('button', { name: 'Cancelar' }).click()
        await expect(dialogo).toHaveCount(0)
        expect(await turnoExiste(sc, turno)).toBe(true)

        await abrirMenuDelBloque(page, sede.name)
        await page.getByRole('menuitem', { name: 'Eliminar turno' }).click()
        await dialogo.getByRole('button', { name: 'Eliminar' }).click()
        await expect(bloqueDe(page, sede.name)).toHaveCount(0)
        await expect.poll(() => turnoExiste(sc, turno)).toBe(false)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'tarjeta punteada (fijo sin asignar): «Eliminar turno» borra el turno y la tarjeta se va (D-02)',
    cubre('RB-A04', 'OI-01', 'OI-04', 'D-02', 'D-06'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const dia = addDays(BASE, 1)
        const { cliente, sede, servicio } = await servicioActivo(
          sc,
          'd06-hueco',
        )
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          dia,
          { start: '08:00', end: '10:00' },
          1,
          { serviceId: servicio.id },
        )
        await agregarFijo(sc, servicio.id, 'empleado4')

        await abrirCalendario(page, 'empleado4', dia)
        const celda = page.getByTestId(`dia-${dia}`)
        const hueco = celda.getByTestId('hueco')
        await expect(hueco).toHaveCount(1)
        await hueco
          .getByRole('button', { name: /^Eliminar el turno de / })
          .click()
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Eliminar' })
          .click()
        await expect(celda.getByTestId('hueco')).toHaveCount(0)
        await expect.poll(() => turnoExiste(sc, turno)).toBe(false)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'Calendario › Día: el ícono «Eliminar» de la fila borra el turno',
    cubre('RB-A05', 'OI-04', 'D-06', 'OD-22'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const dia = addDays(BASE, 2)
        const cliente = await sc.client('d06-dia')
        const sede = await sc.site(cliente.id, 'd06-dia')
        const turno = await sc.shift(cliente.id, sede.id, dia, {
          start: '08:00',
          end: '10:00',
        })

        await page.goto(`/admin/planificacion?vista=dia&fecha=${dia}`)
        const fila = page.getByRole('row').filter({ hasText: sede.name })
        await expect(fila).toBeVisible()
        await fila.getByRole('button', { name: 'Eliminar' }).click()
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Eliminar' })
          .click()
        await expect(fila).toHaveCount(0)
        await expect.poll(() => turnoExiste(sc, turno)).toBe(false)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'un turno con historia (fichajes) no se puede eliminar: el diálogo lo dice y no ofrece «Eliminar»',
    cubre('RB-A05', 'OI-04', 'D-06', 'OD-22', 'CB-14'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const dia = fechaPasada()
        const cliente = await sc.client('d06-hist')
        const sede = await sc.site(cliente.id, 'd06-hist')
        const { shiftId } = await cargarJornada(sc, {
          cliente,
          sede,
          fecha: dia,
          franja: { start: '08:00', end: '10:00' },
          quien: 'empleado3',
          entrada: '08:00',
          salida: '10:00',
        })
        await finalizarTurno(sc, shiftId)

        await page.goto(`/admin/planificacion?vista=dia&fecha=${dia}`)
        const fila = page.getByRole('row').filter({ hasText: sede.name })
        await expect(fila).toBeVisible()
        await fila.getByRole('button', { name: 'Eliminar' }).click()
        const dialogo = page.getByRole('dialog')
        await expect(dialogo).toContainText('No se puede eliminar todavía.')
        await expect(
          dialogo.getByRole('button', { name: 'Eliminar' }),
        ).toHaveCount(0)
        await dialogo.getByRole('button', { name: 'Cancelar' }).click()
        expect(await turnoExiste(sc, shiftId)).toBe(true)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('un administrador no ve «Eliminar turno» (OD-22)', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'ni en el ⋮ del calendario del empleado, ni en la tarjeta punteada, ni en Calendario › Día',
    cubre('RB-A04', 'RB-X02', 'OI-04', 'D-06', 'OD-22', 'CB-17'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const dia = addDays(BASE, 3)
        const cliente = await sc.client('d06-adm')
        const sede = await sc.site(cliente.id, 'd06-adm')
        const turno = await sc.shift(cliente.id, sede.id, dia, {
          start: '08:00',
          end: '10:00',
        })
        await sc.assign(turno, 'empleado3')
        // Un fijo sin asignar para el mismo empleado en otro día: la tarjeta punteada.
        const otroDia = addDays(BASE, 4)
        const {
          cliente: c2,
          sede: s2,
          servicio,
        } = await servicioActivo(sc, 'd06-adm-b')
        await sc.shift(
          c2.id,
          s2.id,
          otroDia,
          { start: '11:00', end: '12:00' },
          1,
          { serviceId: servicio.id },
        )
        await agregarFijo(sc, servicio.id, 'empleado3')

        await abrirCalendario(page, 'empleado3', dia)
        await abrirMenuDelBloque(page, sede.name)
        // El menú abierto tiene sus opciones de siempre, sin «Eliminar turno».
        await expect(
          page.getByRole('menuitem', { name: 'Abrir el turno' }),
        ).toBeVisible()
        await expect(
          page.getByRole('menuitem', { name: 'Eliminar turno' }),
        ).toHaveCount(0)
        await page.keyboard.press('Escape')

        const hueco = page.getByTestId(`dia-${otroDia}`).getByTestId('hueco')
        await expect(hueco).toHaveCount(1)
        await expect(
          hueco.getByRole('button', { name: /^Reemplazar a / }),
        ).toBeVisible()
        await expect(
          hueco.getByRole('button', { name: /^Eliminar el turno de / }),
        ).toHaveCount(0)

        await page.goto(`/admin/planificacion?vista=dia&fecha=${dia}`)
        const fila = page.getByRole('row').filter({ hasText: sede.name })
        await expect(fila).toBeVisible()
        await expect(fila.getByRole('link', { name: 'Editar' })).toBeVisible()
        await expect(
          fila.getByRole('button', { name: 'Eliminar' }),
        ).toHaveCount(0)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
