import { expect, test, type Locator, type Page } from '@playwright/test'
import { weekdayOf } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { abrirCalendario, bloqueDe, fechaDeMes } from '../fixtures/p30.ts'
import { limpiarPersonaP31, servicioActivo } from '../fixtures/p31.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'

// P31.6 · D-05 (OI-02): el color de un turno es el del CLIENTE, una sola fuente. «Cambiar color del
// cliente» desde el menú ⋮ del calendario del mes o desde la tarjeta del cronograma semanal (pizarra)
// pide confirmación («Cambia el color de X en todos los calendarios.») y cambia `clients.calendar_color`:
// el calendario y la pizarra pintan lo mismo. La pizarra guarda `color_index` nulo en las tarjetas de
// un servicio. Escritorio 1280 px. Cuenta de este archivo: empleado2.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const NOMBRES_COLOR = [
  'Azul',
  'Violeta',
  'Naranja',
  'Magenta',
  'Oliva',
  'Celeste',
  'Mostaza',
  'Marrón',
  'Índigo',
  'Pizarra',
  'Turquesa',
  'Rosa',
] as const

const FECHA = fechaDeMes(55)
const DIA_SEMANA = weekdayOf(FECHA)

const fondo = (el: Locator) =>
  el.evaluate((nodo) => getComputedStyle(nodo).backgroundColor)

const pizarra = (page: Page) => page.getByTestId('cronograma-semanal')
const tarjeta = (page: Page, sede: string) =>
  pizarra(page).getByTestId('bloque').filter({ hasText: sede.toUpperCase() })

/** Cliente con un servicio de empleado2 como fijo el día de `FECHA` y su turno asignado ese día. */
async function armar(sc: Scenario, slug: string) {
  const base = await servicioActivo(sc, slug, { start: '09:00', end: '11:00' })
  // Solo un día de la semana: la pizarra arma una sola tarjeta.
  await sc.db
    .from('services')
    .update({ weekdays: [DIA_SEMANA] })
    .eq('id', base.servicio.id)
  const turno = await sc.shift(
    base.cliente.id,
    base.sede.id,
    FECHA,
    { start: '09:00', end: '11:00' },
    1,
    { serviceId: base.servicio.id },
  )
  const { error } = await sc.db
    .from('service_fixed_employees')
    .insert({ service_id: base.servicio.id, employee_id: readId('empleado2') })
  expect(error, error?.message).toBeNull()
  await sc.assign(turno, 'empleado2')
  return { ...base, turno }
}

async function colorDelCliente(sc: Scenario, clienteId: string) {
  const { data, error } = await sc.db
    .from('clients')
    .select('calendar_color')
    .eq('id', clienteId)
    .single()
  expect(error, error?.message).toBeNull()
  return data!.calendar_color
}

/** Un color distinto del actual y del que se pasa en `evitar`. */
const otroColor = (actual: number, evitar = -1) =>
  [3, 5, 7, 9, 11].map((n) => (actual + n) % 12).find((i) => i !== evitar)!

test.describe('color único del cliente en calendario y pizarra (D-05)', () => {
  test.describe('dueño', () => {
    test.use({ storageState: storageStatePath('owner') })

    test(
      'desde el ⋮ del calendario: confirma, cambia el color del cliente y la pizarra pinta lo mismo; la pizarra guarda color nulo',
      cubre('RB-A04', 'RB-A05', 'OI-02', 'D-05', 'OH-07'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          const { cliente, sede } = await armar(sc, 'd05-cal')
          const inicial = await colorDelCliente(sc, cliente.id)
          const nuevo = otroColor(inicial)

          await abrirCalendario(page, 'empleado2', FECHA)
          const bloque = bloqueDe(page, sede.name)
          await expect(bloque).toBeVisible()
          await expect(tarjeta(page, sede.name)).toBeVisible()
          const fondoAntes = await fondo(bloque)
          // Antes del cambio los dos pintan el color del cliente.
          expect(await fondo(tarjeta(page, sede.name))).toBe(fondoAntes)

          await test.step('el ⋮ ofrece «Cambiar color del cliente» y pide confirmar', async () => {
            await bloque
              .getByRole('button', { name: /^Opciones del turno de / })
              .click()
            await page
              .getByRole('menuitem', { name: 'Cambiar color del cliente' })
              .click()
            await page
              .getByRole('menuitem', { name: NOMBRES_COLOR[nuevo] })
              .click()
            const dialogo = page.getByRole('dialog')
            await expect(dialogo).toContainText(
              `Cambia el color de ${cliente.name} en todos los calendarios.`,
            )
            // Cancelar no cambia nada.
            await dialogo.getByRole('button', { name: 'Cancelar' }).click()
            expect(await colorDelCliente(sc, cliente.id)).toBe(inicial)
            await bloque
              .getByRole('button', { name: /^Opciones del turno de / })
              .click()
            await page
              .getByRole('menuitem', { name: 'Cambiar color del cliente' })
              .click()
            await page
              .getByRole('menuitem', { name: NOMBRES_COLOR[nuevo] })
              .click()
            await dialogo.getByRole('button', { name: 'Cambiar color' }).click()
            await expect(
              page.getByText(`Cambiamos el color de ${cliente.name}.`),
            ).toBeVisible()
          })

          await test.step('el cliente tiene el color nuevo y calendario y pizarra pintan lo mismo', async () => {
            await expect.poll(() => colorDelCliente(sc, cliente.id)).toBe(nuevo)
            await expect.poll(() => fondo(bloque)).not.toBe(fondoAntes)
            await expect
              .poll(async () => fondo(tarjeta(page, sede.name)))
              .toBe(await fondo(bloque))
          })

          await test.step('al editar la pizarra, la tarjeta se guarda sin color propio (color_index nulo)', async () => {
            const tarjetaDelDia = tarjeta(page, sede.name)
            await tarjetaDelDia
              .getByRole('button', { name: /^Hora de inicio de / })
              .click()
            const campo = tarjetaDelDia.getByRole('textbox', {
              name: /^Hora de inicio de /,
            })
            await campo.fill('0930')
            await page.keyboard.press('Enter')
            await expect(page.getByTestId('cronograma-estado')).toContainText(
              /^Editado por /,
            )
            const { data } = await sc.db
              .from('employee_week_boards')
              .select('blocks')
              .eq('employee_id', readId('empleado2'))
              .single()
            const bloques = data!.blocks as unknown as Array<{
              service_id: string | null
              color_index: number | null
            }>
            const delServicio = bloques.filter((b) => b.service_id != null)
            expect(delServicio.length).toBeGreaterThan(0)
            expect(delServicio.every((b) => b.color_index === null)).toBe(true)
          })
        } finally {
          expect(await limpiarPersonaP31(sc, 'empleado2')).toEqual([])
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })

  test.describe('administrador', () => {
    test.use({ storageState: storageStatePath('admin') })

    test(
      'desde la tarjeta de la pizarra: un administrador cambia el color del cliente y el calendario del mes lo toma',
      cubre('RB-A04', 'RB-A05', 'RB-X02', 'OI-02', 'D-05', 'CB-17'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          const { cliente, sede } = await armar(sc, 'd05-piz')
          const inicial = await colorDelCliente(sc, cliente.id)
          const nuevo = otroColor(inicial)

          await abrirCalendario(page, 'empleado2', FECHA)
          const bloque = bloqueDe(page, sede.name)
          const fondoAntes = await fondo(bloque)
          const tarjetaDelDia = tarjeta(page, sede.name)
          await expect(tarjetaDelDia).toBeVisible()

          await tarjetaDelDia
            .getByRole('button', { name: /^Opciones del bloque / })
            .click()
          await page
            .getByRole('menuitem', { name: 'Cambiar color del cliente' })
            .click()
          await page
            .getByRole('menuitem', { name: NOMBRES_COLOR[nuevo] })
            .click()
          await expect(page.getByRole('dialog')).toContainText(
            `Cambia el color de ${cliente.name} en todos los calendarios.`,
          )
          await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Cambiar color' })
            .click()

          await expect.poll(() => colorDelCliente(sc, cliente.id)).toBe(nuevo)
          await expect.poll(() => fondo(bloque)).not.toBe(fondoAntes)
          await expect
            .poll(async () => fondo(tarjetaDelDia))
            .toBe(await fondo(bloque))
        } finally {
          expect(await limpiarPersonaP31(sc, 'empleado2')).toEqual([])
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })
})
