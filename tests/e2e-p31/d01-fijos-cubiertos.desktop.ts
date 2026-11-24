import { expect, test } from '@playwright/test'
import { addDays } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { abrirCalendario, fechaDeMes } from '../fixtures/p30.ts'
import { agregarFijo, fechaPasada, servicioActivo } from '../fixtures/p31.ts'
import { Scenario, sessionClient } from '../fixtures/scenario.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'

// P31.6 · D-01 (OI-01): un fijo con licencia o choque cuyo turno ya cubrió OTRA persona deja de
// aparecer como tarjeta punteada («fijo sin asignar») en el calendario del empleado; el que sigue
// sin cubrir y es futuro sí; los turnos pasados no se listan. Escritorio 1280 px, dueño.
// Cuentas de este archivo: empleado1 (fijo) y empleado2 (la reemplazante).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('owner') })

// Mes futuro (día 3 a 24) para no depender del día en que corre.
const BASE = fechaDeMes(40)
const CUBIERTO = BASE
const SIN_CUBRIR = addDays(BASE, 1)

test.describe('fijos sin asignar: lo cubierto y lo pasado no aparecen (D-01)', () => {
  test(
    'con licencia, el turno cubierto por otra persona no es tarjeta punteada y el que no tiene a nadie sí',
    cubre('RB-A04', 'RB-A05', 'OI-01', 'D-01', 'D-02', 'CB-02'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const { sede, servicio, cliente } = await servicioActivo(sc, 'd01-lic')
        const franja = { start: '08:00', end: '10:00' }
        const cubierto = await sc.shift(
          cliente.id,
          sede.id,
          CUBIERTO,
          franja,
          1,
          {
            serviceId: servicio.id,
          },
        )
        await sc.shift(cliente.id, sede.id, SIN_CUBRIR, franja, 1, {
          serviceId: servicio.id,
        })
        // La reemplazante cubre el primero (dotación 1 de 1); el fijo se agrega después y tiene licencia.
        await sc.assign(cubierto, 'empleado2')
        await agregarFijo(sc, servicio.id, 'empleado1')
        await sc.leave('empleado1', CUBIERTO, SIN_CUBRIR)

        await abrirCalendario(page, 'empleado1', CUBIERTO)

        await test.step('el día cubierto por otra persona no muestra ninguna tarjeta punteada', async () => {
          const celda = page.getByTestId(`dia-${CUBIERTO}`)
          await expect(celda).toHaveAttribute('data-kind', 'leave')
          await expect(celda.getByTestId('hueco')).toHaveCount(0)
        })

        await test.step('el día que sigue sin cubrir, y es futuro, sí muestra «De licencia»', async () => {
          const celda = page.getByTestId(`dia-${SIN_CUBRIR}`)
          await expect(celda).toHaveAttribute('data-kind', 'leave')
          const hueco = celda.getByTestId('hueco')
          await expect(hueco).toHaveCount(1)
          await expect(hueco).toHaveAttribute('data-reason', 'ON_LEAVE')
          await expect(hueco).toContainText(sede.name.toUpperCase())
          await expect(hueco.getByTestId('hueco-motivo')).toHaveText(
            'De licencia',
          )
        })

        await test.step('por API: la función lista solo el turno sin cubrir y ya no existe SHIFT_FULL', async () => {
          const dueno = await sessionClient('owner')
          const { data, error } = await dueno.rpc('employee_fixed_gaps', {
            p_employee_id: readId('empleado1'),
            p_from: CUBIERTO,
            p_to: SIN_CUBRIR,
          })
          expect(error, error?.message).toBeNull()
          const filas = (data ?? []) as Array<{
            shift_date: string
            reason: string
          }>
          expect(filas.map((f) => f.shift_date)).toEqual([SIN_CUBRIR])
          expect(filas.some((f) => f.reason === 'SHIFT_FULL')).toBe(false)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'con superposición, el turno que ya cubrió otra persona tampoco aparece',
    cubre('RB-A04', 'OI-01', 'D-01', 'CB-10'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const dia = addDays(BASE, 2)
        const { sede, servicio, cliente } = await servicioActivo(sc, 'd01-sup')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          dia,
          { start: '08:00', end: '10:00' },
          1,
          { serviceId: servicio.id },
        )
        await sc.assign(turno, 'empleado2')
        // El fijo está en otro turno a la misma hora: un choque real que, sin D-01, daría «Se superpone».
        const otroCliente = await sc.client('d01-sup-b')
        const otraSede = await sc.site(otroCliente.id, 'd01-sup-b')
        const otro = await sc.shift(otroCliente.id, otraSede.id, dia, {
          start: '09:00',
          end: '11:00',
        })
        await sc.assign(otro, 'empleado1')
        // Control: el día siguiente del mismo servicio queda sin nadie y SÍ tiene que aparecer.
        await sc.shift(
          cliente.id,
          sede.id,
          addDays(dia, 1),
          { start: '08:00', end: '10:00' },
          1,
          { serviceId: servicio.id },
        )
        await agregarFijo(sc, servicio.id, 'empleado1')

        await abrirCalendario(page, 'empleado1', dia)
        await expect(
          page.getByTestId(`dia-${addDays(dia, 1)}`).getByTestId('hueco'),
        ).toHaveCount(1)
        const celda = page.getByTestId(`dia-${dia}`)
        await expect(celda.getByTestId('turno')).toHaveCount(1)
        await expect(celda.getByTestId('hueco')).toHaveCount(0)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'un turno pasado de un servicio donde la persona es fija y no fue asignada no aparece',
    cubre('RB-A04', 'OI-01', 'D-01'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const pasada = fechaPasada()
        const { sede, servicio, cliente } = await servicioActivo(sc, 'd01-pas')
        await sc.shift(
          cliente.id,
          sede.id,
          pasada,
          { start: '08:00', end: '10:00' },
          1,
          { serviceId: servicio.id },
        )
        // Control: un turno futuro del mismo servicio sin nadie SÍ aparece como tarjeta punteada.
        await sc.shift(
          cliente.id,
          sede.id,
          BASE,
          { start: '08:00', end: '10:00' },
          1,
          { serviceId: servicio.id },
        )
        await agregarFijo(sc, servicio.id, 'empleado1')

        await abrirCalendario(page, 'empleado1', BASE)
        await expect(
          page.getByTestId(`dia-${BASE}`).getByTestId('hueco'),
        ).toHaveCount(1)

        await abrirCalendario(page, 'empleado1', pasada)
        const celda = page.getByTestId(`dia-${pasada}`)
        await expect(celda).toBeVisible()
        await expect(celda.getByTestId('hueco')).toHaveCount(0)

        const dueno = await sessionClient('owner')
        const { data, error } = await dueno.rpc('employee_fixed_gaps', {
          p_employee_id: readId('empleado1'),
          p_from: pasada,
          p_to: pasada,
        })
        expect(error, error?.message).toBeNull()
        expect(data ?? []).toEqual([])
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
