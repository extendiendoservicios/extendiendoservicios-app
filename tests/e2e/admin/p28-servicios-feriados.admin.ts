import { expect, test, type Page } from '@playwright/test'
import { anioLejano, nombreDe, reNombreDe } from '../../fixtures/accounts.ts'
import { addDays, daysFromToday } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario, uniqueName } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { capturar } from '../../fixtures/capturas.ts'
import { cubre } from '../../fixtures/trace.ts'
import { pickDate } from '../../fixtures/ui.ts'
import {
  crearLicencia,
  darDeBajaLicencias,
} from '../../e2e-ajustes-reunion/helpers/dia.ts'

// P28.7: lo nuevo de servicios y turnos de las observaciones del 11 nov 2026 (escritorio, 1280 px).
//   - OF-19 / OF-19b: feriado sobre una fecha ya existente (dada de baja) y ofrecimiento de
//     borrar los turnos de servicios que no trabajan feriados.
//   - OF-05: editar dotación u horario de un servicio con turnos futuros -> diálogo -> aplicar ->
//     turnos actualizados; y «Actualizar turnos desde…».
//   - OF-02: aviso de duplicado al crear un servicio y un turno suelto.
//   - OF-04: lista de servicios con fijos, asignados y «Sin cubrir».
//   - OF-08: choque de asignación con el mensaje de sede y horario, y «Ver turno».
//   - OF-20: dos licencias superpuestas.
// Empleados de este archivo: empleado3 y empleado4. Fechas relativas a hoy en hora de Argentina.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

/** «Vigente desde» = hoy (la fecha de inicio es obligatoria en el alta). */
async function elegirVigencia(page: Page): Promise<void> {
  const [anio, mes, dia] = daysFromToday(0).split('-').map(Number)
  await pickDate(page, 'Vigente desde', { year: anio, month: mes, day: dia })
}

test.describe('feriados (OF-19, OF-19b)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'cargar un feriado sobre una fecha dada de baja la reactiva y ofrece borrar los turnos de servicios que no trabajan feriados',
    cubre('RB-A04', 'P-050', 'CB-09', 'OF-19', 'OF-19b'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      const anio = anioLejano()
      const fecha = `${anio}-10-22`
      try {
        const cliente = await sc.client('of19')
        const sede = await sc.site(cliente.id, 'of19')
        const servicio = await sc.service(cliente.id, sede.id, 'of19', {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          worksOnHolidays: false,
          status: 'paused',
          validFrom: daysFromToday(0),
        })
        const { data: turno, error } = await sc.db
          .from('shifts')
          .insert({
            client_id: cliente.id,
            site_id: sede.id,
            service_id: servicio.id,
            shift_date: fecha,
            start_time: '08:00',
            end_time: '12:00',
            required_staff: 1,
            generated: true,
          })
          .select('id')
          .single()
        expect(error, error?.message).toBeNull()
        sc.extraShiftIds.push(turno!.id)

        // Una baja previa de esa misma fecha: antes de 0082 dejaba la fecha trabada para siempre.
        await sc.holiday(fecha, 'e2e-feriado-previo')
        await sc.db
          .from('holidays')
          .update({ deleted_at: new Date().toISOString() })
          .eq('holiday_date', fecha)

        await page.goto('/admin/configuracion/feriados')
        await page.getByRole('button', { name: 'Nuevo feriado' }).click()
        const dialogo = page.getByRole('dialog', { name: 'Nuevo feriado' })
        await pickDate(page, 'Fecha del feriado', {
          year: anio,
          month: 10,
          day: 22,
        })
        const nombre = 'e2e-feriado-reactivado'
        await dialogo.getByLabel('Nombre').fill(nombre)
        await dialogo.getByRole('button', { name: 'Agregar feriado' }).click()

        await test.step('OF-19: se agrega (reactiva) sin error y no queda duplicado', async () => {
          await expect(page.getByText('Agregamos el feriado.')).toBeVisible()
          const { data } = await sc.db
            .from('holidays')
            .select('name, deleted_at')
            .eq('holiday_date', fecha)
          expect(data).toHaveLength(1)
          expect(data?.[0]?.deleted_at).toBeNull()
          expect(data?.[0]?.name).toBe(nombre)
        })

        await test.step('OF-19b: ofrece eliminar el turno del servicio que no trabaja feriados', async () => {
          const aviso = page.getByRole('dialog', {
            name: 'Turnos en el feriado',
          })
          await expect(aviso).toContainText(
            'Hay 1 turno ese día de servicios que no trabajan feriados. ¿Eliminarlos?',
          )
          await expect(aviso).toContainText(servicio.name)
          await aviso
            .getByRole('button', { name: 'Eliminar los turnos' })
            .click()
          await expect(aviso).toHaveCount(0)
          await expect
            .poll(async () => {
              const { data } = await sc.db
                .from('shifts')
                .select('id')
                .eq('id', turno!.id)
              return data?.length ?? -1
            })
            .toBe(0)
        })
      } finally {
        await sc.db
          .from('security_events')
          .delete()
          .eq('event_type', 'record_deleted')
          .eq('details->>date', fecha)
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    '«Dejarlos» deja los turnos como están',
    cubre('RB-A04', 'P-050', 'OF-19b'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      const anio = anioLejano()
      const fecha = `${anio}-10-23`
      try {
        const cliente = await sc.client('of19b-dejar')
        const sede = await sc.site(cliente.id, 'of19b-dejar')
        const servicio = await sc.service(cliente.id, sede.id, 'of19b-dejar', {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          worksOnHolidays: false,
          status: 'paused',
        })
        const { data: turno } = await sc.db
          .from('shifts')
          .insert({
            client_id: cliente.id,
            site_id: sede.id,
            service_id: servicio.id,
            shift_date: fecha,
            start_time: '08:00',
            end_time: '12:00',
            required_staff: 1,
            generated: true,
          })
          .select('id')
          .single()
        sc.extraShiftIds.push(turno!.id)
        sc.extraHolidayDates.push(fecha)

        await page.goto('/admin/configuracion/feriados')
        await page.getByRole('button', { name: 'Nuevo feriado' }).click()
        await pickDate(page, 'Fecha del feriado', {
          year: anio,
          month: 10,
          day: 23,
        })
        await page
          .getByRole('dialog', { name: 'Nuevo feriado' })
          .getByLabel('Nombre')
          .fill('e2e-feriado-dejar')
        await page
          .getByRole('dialog', { name: 'Nuevo feriado' })
          .getByRole('button', { name: 'Agregar feriado' })
          .click()
        const aviso = page.getByRole('dialog', { name: 'Turnos en el feriado' })
        await expect(aviso).toBeVisible()
        await aviso.getByRole('button', { name: 'Dejarlos' }).click()
        await expect(aviso).toHaveCount(0)
        const { data } = await sc.db
          .from('shifts')
          .select('id')
          .eq('id', turno!.id)
        expect(data).toHaveLength(1)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('cambios del servicio en los turnos (OF-05)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'editar la dotación de un servicio con turnos futuros abre el diálogo, aplica y los turnos quedan con la dotación nueva; «No aplicar» no toca nada',
    cubre('RB-A04', 'P-044', 'OF-05', 'OD-11'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of05')
        const sede = await sc.site(cliente.id, 'of05')
        const servicio = await sc.service(cliente.id, sede.id, 'of05', {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          staff: 1,
          validFrom: daysFromToday(0),
        })
        const dias = [4, 5, 6]
        const turnos: string[] = []
        for (const d of dias) {
          turnos.push(
            await sc.shift(
              cliente.id,
              sede.id,
              daysFromToday(d),
              { start: '08:00', end: '12:00' },
              1,
              { serviceId: servicio.id },
            ),
          )
        }
        // `generated` lo marca el generador; el insert directo no lo hace.
        await sc.db.from('shifts').update({ generated: true }).in('id', turnos)

        await test.step('cambiar la dotación a 3 y guardar abre «¿Aplicar los cambios a los turnos desde el …?»', async () => {
          await page.goto(`/admin/servicios/${servicio.id}/editar`)
          await expect(page.getByLabel('Nombre')).toHaveValue(servicio.name)
          await page.getByLabel('Dotación').fill('3')
          await page.getByRole('button', { name: 'Guardar cambios' }).click()
          const dialogo = page.getByRole('dialog')
          await expect(
            dialogo.getByRole('heading', {
              name: /¿Aplicar los cambios a los turnos desde el/,
            }),
          ).toBeVisible()
          await expect(dialogo).toContainText(/Se actualizan 3 turnos/)
        })

        await test.step('«No aplicar» deja los turnos con dotación 1', async () => {
          await page
            .getByRole('dialog')
            .getByRole('button', { name: 'No aplicar' })
            .click()
          const { data } = await sc.db
            .from('shifts')
            .select('required_staff')
            .in('id', turnos)
          expect(data?.map((t) => t.required_staff)).toEqual([1, 1, 1])
        })

        await test.step('«Actualizar turnos desde…» aplica la dotación guardada (casos Lutova y Foster)', async () => {
          await page.goto(`/admin/servicios/${servicio.id}/editar`)
          await page
            .getByRole('button', { name: /Actualizar turnos desde/ })
            .click()
          const dialogo = page.getByRole('dialog')
          await expect(dialogo).toContainText(/Se actualizan 3 turnos/)
          await dialogo
            .getByRole('button', { name: 'Aplicar', exact: true })
            .click()
          await expect(
            dialogo.getByRole('heading', { name: 'Resultado' }),
          ).toBeVisible()
          await expect(dialogo).toContainText(/Actualizamos 3 turnos/)
          await dialogo.getByRole('button', { name: 'Listo' }).click()
          const { data } = await sc.db
            .from('shifts')
            .select('required_staff')
            .in('id', turnos)
          expect(data?.map((t) => t.required_staff)).toEqual([3, 3, 3])
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'cambiar el horario actualiza los turnos con el horario viejo, saltea el cambiado a mano y quita los días que el servicio ya no tiene',
    cubre('RB-A04', 'OF-05'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of05h')
        const sede = await sc.site(cliente.id, 'of05h')
        const servicio = await sc.service(cliente.id, sede.id, 'of05h', {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          validFrom: daysFromToday(0),
        })
        const normal = await sc.shift(
          cliente.id,
          sede.id,
          daysFromToday(4),
          { start: '08:00', end: '12:00' },
          1,
          { serviceId: servicio.id },
        )
        const aMano = await sc.shift(
          cliente.id,
          sede.id,
          daysFromToday(5),
          { start: '09:00', end: '13:00' },
          1,
          { serviceId: servicio.id },
        )
        await sc.db
          .from('shifts')
          .update({ generated: true })
          .in('id', [normal, aMano])

        await page.goto(`/admin/servicios/${servicio.id}/editar`)
        await expect(page.getByLabel('Nombre')).toHaveValue(servicio.name)
        await page.getByLabel('Desde').first().fill('10:00')
        await page.getByLabel('Hasta').first().fill('14:00')
        await page.getByRole('button', { name: 'Guardar cambios' }).click()
        const dialogo = page.getByRole('dialog')
        await expect(
          dialogo.getByRole('heading', {
            name: /¿Aplicar los cambios a los turnos desde el/,
          }),
        ).toBeVisible()
        await expect(dialogo).toContainText(/Se actualiza 1 turno/)
        // El de horario cambiado a mano se conserva y se explica por qué.
        await expect(dialogo).toContainText('No se tocan (1)')
        await expect(dialogo).toContainText('se lo cambió a mano y se conserva')
        await dialogo
          .getByRole('button', { name: 'Aplicar', exact: true })
          .click()
        await expect(
          dialogo.getByRole('heading', { name: 'Resultado' }),
        ).toBeVisible()
        await dialogo.getByRole('button', { name: 'Listo' }).click()

        const { data } = await sc.db
          .from('shifts')
          .select('id, start_time, end_time')
          .in('id', [normal, aMano])
        const por = Object.fromEntries((data ?? []).map((t) => [t.id, t]))
        expect(por[normal]?.start_time.slice(0, 5)).toBe('10:00')
        expect(por[normal]?.end_time.slice(0, 5)).toBe('14:00')
        // El cambiado a mano conserva su horario.
        expect(por[aMano]?.start_time.slice(0, 5)).toBe('09:00')
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('avisos de duplicado (OF-02)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'crear un servicio que coincide con otro de la misma sede avisa y deja «Guardar igual»; un turno suelto en horario ocupado avisa «¿Crear igual?»',
    cubre('RB-A04', 'OF-02'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of02')
        const sede = await sc.site(cliente.id, 'of02')
        const existente = await sc.service(cliente.id, sede.id, 'of02-previo', {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          start: '15:00',
          end: '17:00',
        })

        await test.step('servicio nuevo con los mismos días y un horario que se pisa', async () => {
          const nombre = uniqueName('of02-dup')
          await page.goto(`/admin/servicios/nuevo?cliente=${cliente.id}`)
          await page.getByRole('combobox', { name: 'Sede' }).click()
          await page.getByRole('option', { name: sede.name }).click()
          await page.getByLabel('Nombre').fill(nombre)
          for (const d of [
            'Lunes',
            'Martes',
            'Miércoles',
            'Jueves',
            'Viernes',
            'Sábado',
            'Domingo',
          ]) {
            await page.getByLabel(d).check()
          }
          await page.getByLabel('Desde').first().fill('16:00')
          await page.getByLabel('Hasta').first().fill('18:00')
          await elegirVigencia(page)
          await page.getByRole('button', { name: 'Crear servicio' }).click()
          const aviso = page.getByRole('dialog', {
            name: 'Posible servicio duplicado',
          })
          await expect(aviso).toBeVisible()
          await expect(aviso).toContainText(existente.name)
          await expect(aviso).toContainText('¿Guardar igual?')
          // «Volver» no crea nada.
          await aviso.getByRole('button', { name: 'Volver' }).click()
          const { data: antes } = await sc.db
            .from('services')
            .select('id')
            .eq('name', nombre)
          expect(antes).toHaveLength(0)
          // «Guardar igual» sí lo crea (no bloquea).
          await page.getByRole('button', { name: 'Crear servicio' }).click()
          await page
            .getByRole('dialog', { name: 'Posible servicio duplicado' })
            .getByRole('button', { name: 'Guardar igual' })
            .click()
          await expect(page.getByText('Creamos el servicio.')).toBeVisible()
          const { data: despues } = await sc.db
            .from('services')
            .select('id')
            .eq('name', nombre)
          expect(despues).toHaveLength(1)
          sc.extraServiceIds.push(despues![0].id)
        })

        await test.step('un horario que no se pisa no avisa (contraprueba)', async () => {
          const nombre = uniqueName('of02-ok')
          await page.goto(`/admin/servicios/nuevo?cliente=${cliente.id}`)
          await page.getByRole('combobox', { name: 'Sede' }).click()
          await page.getByRole('option', { name: sede.name }).click()
          await page.getByLabel('Nombre').fill(nombre)
          await page.getByLabel('Lunes').check()
          await page.getByLabel('Desde').first().fill('06:00')
          await page.getByLabel('Hasta').first().fill('07:00')
          await elegirVigencia(page)
          await page.getByRole('button', { name: 'Crear servicio' }).click()
          await expect(page.getByText('Creamos el servicio.')).toBeVisible()
          await expect(
            page.getByRole('dialog', { name: 'Posible servicio duplicado' }),
          ).toHaveCount(0)
          const { data } = await sc.db
            .from('services')
            .select('id')
            .eq('name', nombre)
          if (data?.[0]) sc.extraServiceIds.push(data[0].id)
        })

        await test.step('turno suelto en una sede que ya tiene un turno a esa hora', async () => {
          const dia = daysFromToday(9)
          await sc.shift(cliente.id, sede.id, dia, {
            start: '12:30',
            end: '14:30',
          })
          await page.goto(`/admin/turnos/nuevo?fecha=${dia}`)
          await page.getByRole('combobox', { name: 'Cliente' }).click()
          await page.getByRole('option', { name: cliente.name }).click()
          await page.getByRole('combobox', { name: 'Sede' }).click()
          await page.getByRole('option', { name: sede.name }).click()
          await page.getByLabel('Desde').first().fill('13:00')
          await page.getByLabel('Hasta').first().fill('15:00')
          await page
            .getByRole('button', { name: /Crear turno|Guardar/ })
            .click()
          const aviso = page.getByRole('dialog').filter({
            hasText: '¿Crear igual?',
          })
          await expect(aviso).toBeVisible()
          await expect(aviso).toContainText('12:30 a 14:30')
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('lista de servicios con asignados (OF-04)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'cada servicio muestra sus fijos, el próximo turno con quién está asignado y «Sin cubrir» cuando falta gente',
    cubre('RB-A04', 'OF-04', 'P-044'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('of04')
        const sede = await sc.site(cliente.id, 'of04')
        const cubierto = await sc.service(cliente.id, sede.id, 'of04-ok', {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          start: '06:00',
          end: '07:00',
        })
        const faltante = await sc.service(cliente.id, sede.id, 'of04-falta', {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          start: '08:00',
          end: '09:00',
          staff: 2,
        })
        const dia = daysFromToday(3)
        const t1 = await sc.shift(
          cliente.id,
          sede.id,
          dia,
          { start: '06:00', end: '07:00' },
          1,
          { serviceId: cubierto.id },
        )
        const t2 = await sc.shift(
          cliente.id,
          sede.id,
          dia,
          { start: '08:00', end: '09:00' },
          2,
          { serviceId: faltante.id },
        )
        await sc.assign(t1, 'empleado3')
        await sc.assign(t2, 'empleado4')
        // Un fijo en el servicio cubierto.
        const { error } = await sc.db
          .from('service_fixed_employees')
          .insert({ service_id: cubierto.id, employee_id: readId('empleado3') })
        expect(error, error?.message).toBeNull()

        await page.goto(`/admin/clientes/${cliente.id}?pestana=servicios`)
        const tarjeta = (nombre: string) =>
          page.locator('li, article, div').filter({ hasText: nombre }).last()
        await expect(page.getByText(cubierto.name)).toBeVisible()

        const filaOk = page
          .getByText(cubierto.name)
          .locator('xpath=ancestor::*[contains(., "Fijos:")][1]')
        await expect(filaOk).toContainText(`Fijos: ${nombreDe('empleado3')}`)
        await expect(filaOk).toContainText(nombreDe('empleado3'))
        await expect(filaOk).not.toContainText('Faltan')

        const filaFalta = page
          .getByText(faltante.name)
          .locator('xpath=ancestor::*[contains(., "Fijos:")][1]')
        await expect(filaFalta).toContainText('Fijos: ninguno')
        await expect(filaFalta).toContainText(nombreDe('empleado4'))
        await expect(filaFalta).toContainText('Faltan 1 de 2.')
        await expect(filaFalta.getByText('Sin cubrir').first()).toBeVisible()
        void tarjeta
      } finally {
        await sc.db
          .from('service_fixed_employees')
          .delete()
          .in('service_id', sc.extraServiceIds)
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('choque de asignación con mensaje y «Ver turno» (OF-08)', () => {
  test.use({ storageState: storageStatePath('owner') })

  /** Dos turnos que se pisan el mismo día en dos sedes; empleado3 ya está en el A y se intenta asignar al B. */
  async function armarChoque(sc: Scenario, page: Page) {
    const dia = daysFromToday(7)
    const clienteA = await sc.client('of08a')
    const sedeA = await sc.site(clienteA.id, 'of08a')
    const clienteB = await sc.client('of08b')
    const sedeB = await sc.site(clienteB.id, 'of08b')
    const turnoA = await sc.shift(clienteA.id, sedeA.id, dia, {
      start: '15:00',
      end: '17:00',
    })
    const turnoB = await sc.shift(clienteB.id, sedeB.id, dia, {
      start: '16:00',
      end: '18:00',
    })
    await sc.assign(turnoA, 'empleado3')

    await page.goto(`/admin/turnos/${turnoB}`)
    await page.getByRole('button', { name: 'Asignar empleado' }).click()
    const hoja = page.getByRole('dialog', { name: 'Asignar empleado' })
    const candidato = hoja.getByRole('radio', {
      name: reNombreDe('empleado3'),
    })
    await expect(candidato).toBeVisible()
    // La hoja ya marca el choque («Se superpone con …»); igual se intenta y el servidor lo rechaza.
    await candidato.click()
    await hoja.getByRole('button', { name: 'Asignar', exact: true }).click()
    return { turnoA, turnoB, sedeA }
  }

  test(
    'asignar a quien ya está en otro turno superpuesto dice dónde (sede, fecha y horario) y ofrece «Ver turno»; no asigna',
    cubre('RB-A04', 'CB-02', 'OF-08'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const { turnoB, sedeA } = await armarChoque(sc, page)
        // El mensaje dice con qué choca: persona, sede, fecha y horario.
        const mensaje = page.getByText(/ya está en .* de 15:00 a 17:00/).first()
        await expect(mensaje).toBeVisible()
        await expect(mensaje).toContainText(sedeA.name)
        await expect(mensaje).toContainText(/el \p{L}{3} \d{1,2}\/\d{1,2}/u)
        await expect(
          page.getByRole('button', { name: 'Ver turno' }).first(),
        ).toBeVisible()
        await capturar(page, 'of08-choque-con-ver-turno')
        const { data } = await sc.db
          .from('assignments')
          .select('id')
          .eq('shift_id', turnoB)
          .is('removed_at', null)
        expect(data).toHaveLength(0)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'DEF-P28-01: «Ver turno» del aviso lleva al turno de choque aun con la hoja «Asignar empleado» abierta',
    {
      ...cubre('RB-A04', 'CB-02', 'OF-08'),
    },
    async ({ page }) => {
      test.setTimeout(120_000)
      const sc = new Scenario()
      try {
        const { turnoA } = await armarChoque(sc, page)
        const ver = page.getByRole('button', { name: 'Ver turno' }).first()
        await expect(ver).toBeVisible()
        // `click()` espera a que el aviso termine de entrar y verifica que el toque le llegue al
        // botón (si la hoja lo tapara, falla por «intercepts pointer events»).
        await ver.click({ timeout: 5_000 })
        await expect(page).toHaveURL(new RegExp(`/admin/turnos/${turnoA}`), {
          timeout: 5_000,
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('licencias superpuestas (OF-20)', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'se pueden cargar dos licencias que se pisan y las dos quedan listadas',
    cubre('RB-A03', 'CB-25', 'OF-20'),
    async ({ page }) => {
      test.setTimeout(120_000)
      try {
        await page.goto(`/admin/empleados/${readId('empleado4')}`)
        await page.getByRole('tab', { name: 'Licencias' }).click()
        const desde = daysFromToday(60)
        const alta = async (
          hasta: string,
          motivo: string,
          desdeFecha = desde,
        ) => {
          await page.getByLabel('Desde').fill(desdeFecha)
          await page.getByLabel('Hasta (opcional)').fill(hasta)
          await page.getByLabel('Motivo (opcional)').fill(`E2E-P1911 ${motivo}`)
          await page.getByRole('button', { name: 'Agregar licencia' }).click()
        }
        await alta(addDays(desde, 9), 'vacaciones-of20')
        await expect(page.getByText('Agregamos la licencia.')).toBeVisible()
        // La segunda empieza dentro de la primera: antes daba LEAVE_OVERLAP.
        await alta(addDays(desde, 12), 'enfermedad-of20', addDays(desde, 4))
        await expect(
          page.getByText('Agregamos la licencia.').first(),
        ).toBeVisible()
        await expect(page.getByText('vacaciones-of20')).toBeVisible()
        await expect(page.getByText('enfermedad-of20')).toBeVisible()
      } finally {
        expect(await darDeBajaLicencias('empleado4'), 'bajas').toEqual([])
        void crearLicencia
      }
    },
  )
})
