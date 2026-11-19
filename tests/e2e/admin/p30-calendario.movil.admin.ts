import { expect, test } from '@playwright/test'
import { addDays } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  abrirCalendario,
  bloqueDe,
  fechaDeMes,
  horarioDe,
  limpiarPersona,
} from '../../fixtures/p30.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P30.5 · OH-05 (PROPUESTO: «en celular el mes se ve como hoy, sin arrastre; los cambios se hacen
// tocando») y OH-07 en el celular (proyecto `mobile`, 390 px, táctil). La ficha del empleado con
// «Calendario» y «Cronograma semanal»: sin desplazamiento horizontal de la página, la hora se edita
// tocando y el menú del turno mueve sin arrastre. Cuenta: empleado3 (calendario) y empleado5 (pizarra; empleado2 es de la prueba de escritorio, que puede correr al mismo tiempo).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

// Base propia: la prueba de escritorio (p28-cronograma) usa a empleado3 en los primeros días de otro tramo.
const BASE = fechaDeMes(25)
const dia = (n: number) => addDays(BASE, n)

test.describe('calendario del empleado en el celular (OH-05, OH-07)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'el mes no desborda, la hora se edita tocando y el menú del turno mueve de día sin arrastrar',
    cubre('RB-A04', 'RB-A05', 'OH-05', 'DEF-P30-05'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('movcal')
        const sede = await sc.site(cliente.id, 'movcal')
        const turno = await sc.shift(cliente.id, sede.id, dia(1), {
          start: '08:00',
          end: '10:00',
        })
        await sc.assign(turno, 'empleado3')
        await abrirCalendario(page, 'empleado3', dia(1))
        await expectNoHorizontalScroll(page)

        const b = bloqueDe(page, sede.name)
        await b.evaluate((el) => el.scrollIntoView({ block: 'center' }))
        await test.step('tocar la hora de fin y escribir «1100»', async () => {
          await b
            .getByRole('button', { name: /^Hora de fin del turno de/ })
            .tap()
          const campo = b.getByRole('textbox', {
            name: /^Hora de fin del turno de/,
          })
          await campo.fill('1100')
          await campo.press('Enter')
          await expect
            .poll(async () => (await horarioDe(sc, turno)).fin)
            .toBe('11:00')
        })

        await test.step('menú del turno → «Mover o cambiar horario…» cambia de día', async () => {
          await b.getByRole('button', { name: /^Opciones del turno de/ }).tap()
          await page
            .getByRole('menuitem', { name: 'Mover o cambiar horario…' })
            .tap()
          const mover = page.getByRole('dialog', {
            name: 'Mover o cambiar horario',
          })
          await mover.getByRole('combobox', { name: 'Día' }).tap()
          await page
            // El día se muestra como «lun 7 dic» (el nombre accesible lleva espacios alrededor del número).
            .getByRole('option', { name: ` ${Number(dia(2).slice(8))} ` })
            .first()
            .tap()
          await mover.getByRole('button', { name: 'Mover' }).tap()
          await expect
            .poll(async () => (await horarioDe(sc, turno)).fecha)
            .toBe(dia(2))
        })
        await expectNoHorizontalScroll(page)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'el cronograma semanal de la cabecera se ve sin desplazar la página y se edita tocando',
    cubre('RB-A05', 'OH-07'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('movpiz')
        const sede = await sc.site(cliente.id, 'movpiz')
        const servicio = await sc.service(cliente.id, sede.id, 'movpiz', {
          weekdays: [1],
          start: '09:00',
          end: '11:00',
        })
        const { error } = await sc.db
          .from('service_fixed_employees')
          .insert({ service_id: servicio.id, employee_id: readId('empleado5') })
        expect(error, error?.message).toBeNull()

        await page.goto(`/admin/empleados/${readId('empleado5')}`)
        const tabla = page.getByTestId('cronograma-semanal')
        await expect(tabla).toBeVisible()
        await expectNoHorizontalScroll(page)
        const lunes = tabla.getByTestId('columna-1').getByTestId('bloque')
        await expect(lunes).toContainText(sede.name.toUpperCase())
        await lunes.getByRole('button', { name: /^Hora de inicio de / }).tap()
        await lunes
          .getByRole('textbox', { name: /^Hora de inicio de / })
          .fill('0930')
        await lunes
          .getByRole('textbox', { name: /^Hora de inicio de / })
          .press('Enter')
        await expect(page.getByTestId('cronograma-estado')).toContainText(
          /^Editado/,
        )
      } finally {
        // Se cierra la página antes de limpiar: el guardado automático de la pizarra no puede reescribirla.
        await page.close()
        await sc.db
          .from('service_fixed_employees')
          .delete()
          .in('service_id', sc.extraServiceIds)
        expect(
          await limpiarPersona(sc, 'empleado5'),
          'limpieza persona',
        ).toEqual([])
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
