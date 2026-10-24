import { expect, test, type Page } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import {
  daysFromToday,
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
  todayAR,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { FRANJAS_MOVIL, POSICION_SIMULADA } from '../../fixtures/movil.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'
import { cargarJornada } from '../../e2e-ajustes-reunion/helpers/historial.ts'

// P24.5: administración de la coordinación libre y la jornada del coordinador (CJ-01, CJ-03,
// CJ-13, CJ-17, CJ-19, CJ-22, CJ-24, CJ-31, CJ-32, CJ-33, CJ-34): preferencias del coordinador
// (ficha, cliente y sede), pestaña «Jornadas» con las cuatro correcciones con motivo, «Sin cerrar»
// y «Cerrada automáticamente», Resumen, Asistencia «Coordinadores», ficha imprimible con firmas y
// que ya no exista «Asignar supervisión». Cuentas: owner y admin (todas las capacidades);
// adminSinCapacidades de contraste; supervisor1 y supervisor2 como coordinadores; dual con los dos
// roles; empleado1 como empleado del turno.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

/** Elige una opción de un combobox del diseño (el botón con ese nombre accesible). */
async function elegir(page: Page, combobox: string, opcion: string | RegExp) {
  await page.getByRole('combobox', { name: combobox }).click()
  await page.getByRole('option', { name: opcion }).click()
}

test.describe('preferencias del coordinador', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'CJ-03, CJ-24: se agrega un cliente entero y una sede desde la ficha y se quitan; se refleja en «Mis sedes» del coordinador',
    cubre('RB-A06', 'RB-S02', 'CJ-03', 'CJ-04', 'CJ-24', 'P-014'),
    async ({ page, browser }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      const supervisorCtx = await browser.newContext({
        storageState: storageStatePath('supervisor1'),
        geolocation: POSICION_SIMULADA,
        permissions: ['geolocation'],
        viewport: { width: 390, height: 844 },
      })
      try {
        await sc.tomarCoordinador('supervisor1')
        const clienteA = await sc.client('pref-a')
        const sedeA1 = await sc.site(clienteA.id, 'pref-a1')
        const sedeA2 = await sc.site(clienteA.id, 'pref-a2')
        const clienteB = await sc.client('pref-b')
        const sedeB1 = await sc.site(clienteB.id, 'pref-b1')
        for (const [cliente, sede] of [
          [clienteA, sedeA1],
          [clienteA, sedeA2],
          [clienteB, sedeB1],
        ] as const) {
          await sc.shift(
            cliente.id,
            sede.id,
            sc.today,
            FRANJAS_MOVIL.diaCompleto,
          )
        }
        const fichaUrl = `/admin/empleados/${readId('supervisor1')}?pestana=preferenciales`
        const celular = await supervisorCtx.newPage()

        const mis = (p: Page) => p.getByRole('region', { name: 'Mis sedes' })
        const otras = (p: Page) =>
          p.getByRole('region', { name: 'Otras sedes' })

        await test.step('la pestaña existe en la ficha del coordinador y arranca vacía', async () => {
          await page.goto(`/admin/empleados/${readId('supervisor1')}`)
          await expect(
            page.getByRole('tab', { name: 'Clientes y sedes preferenciales' }),
          ).toBeVisible()
          await expect(
            page.getByRole('tab', { name: 'Jornadas' }),
          ).toBeVisible()
          await page.goto(fichaUrl)
          await expect(
            page.getByText('Todavía no tiene clientes ni sedes preferenciales'),
          ).toBeVisible()
        })

        await test.step('un cliente entero: todas sus sedes pasan a «Mis sedes» del coordinador', async () => {
          await elegir(page, 'Elegir cliente preferencial', clienteA.name)
          await page.getByRole('button', { name: 'Agregar' }).click()
          await expect(
            page.getByText('Agregamos el cliente como preferencial.'),
          ).toBeVisible()
          await expect(
            page.getByText('Cliente entero, todas sus sedes').first(),
          ).toBeVisible()
          await celular.goto('/sup')
          await expect(mis(celular)).toContainText(sedeA1.name)
          await expect(mis(celular)).toContainText(sedeA2.name)
          await expect(otras(celular)).toContainText(sedeB1.name)
        })

        await test.step('una sede suelta de otro cliente', async () => {
          await page.getByRole('radio', { name: 'Una sede' }).click()
          await elegir(
            page,
            'Elegir sede preferencial',
            new RegExp(`${clienteB.name}.*${sedeB1.name}`),
          )
          await page.getByRole('button', { name: 'Agregar' }).click()
          await expect(
            page.getByText('Agregamos la sede como preferencial.'),
          ).toBeVisible()
          await celular.reload()
          await expect(mis(celular)).toContainText(sedeB1.name)
        })

        await test.step('quitar: baja lógica (nada se borra, P-014) y el coordinador lo ve', async () => {
          await page
            .getByRole('button', { name: `Quitar ${clienteA.name}` })
            .click()
          await expect(
            page.getByText(`Quitamos ${clienteA.name} de los preferenciales.`),
          ).toBeVisible()
          await celular.reload()
          await expect(otras(celular)).toContainText(sedeA1.name)
          await expect(mis(celular)).not.toContainText(sedeA1.name)
          const { data } = await sc.db
            .from('supervisor_priorities')
            .select('client_id, site_id, removed_at, removed_by')
            .eq('supervisor_id', readId('supervisor1'))
          expect(data).toHaveLength(2)
          const baja = data!.find((p) => p.client_id === clienteA.id)
          expect(baja?.removed_at).not.toBeNull()
          expect(baja?.removed_by).toBe(readId('admin'))
          expect(
            data!.find((p) => p.site_id === sedeB1.id)?.removed_at,
          ).toBeNull()
        })
      } finally {
        await supervisorCtx.close()
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'CJ-03, CJ-24: el bloque «Coordinadores preferenciales» del cliente y de la sede agrega y quita; la sede muestra la preferencia heredada del cliente',
    cubre('RB-A04', 'RB-S02', 'CJ-03', 'CJ-24'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('pref-bloque')
        const sede = await sc.site(cliente.id, 'pref-bloque')
        await sc.prioridad('supervisor2', { clientId: cliente.id })

        await test.step('cliente: agrega al coordinador 1 y quita al 1', async () => {
          await page.goto(`/admin/clientes/${cliente.id}`)
          const bloque = page.getByRole('region', {
            name: 'Coordinadores preferenciales',
          })
          await expect(bloque).toContainText(nombreDe('supervisor2'))
          await elegir(
            page,
            'Elegir coordinador preferencial',
            nombreDe('supervisor1'),
          )
          await bloque.getByRole('button', { name: 'Agregar' }).click()
          await expect(bloque).toContainText(nombreDe('supervisor1'))
          await bloque
            .getByRole('button', {
              name: `Quitar a ${nombreDe('supervisor1')}`,
            })
            .click()
          await expect(
            page.getByText(
              `Quitamos a ${nombreDe('supervisor1')} de los preferenciales.`,
            ),
          ).toBeVisible()
        })

        await test.step('sede: ve la preferencia del cliente como heredada y no se puede quitar desde ahí', async () => {
          await page.goto(`/admin/sedes/${sede.id}`)
          const bloque = page.getByRole('region', {
            name: 'Coordinadores preferenciales',
          })
          await expect(bloque).toContainText(nombreDe('supervisor2'))
          await expect(bloque).toContainText('Por el cliente entero')
          await expect(
            bloque.getByRole('button', {
              name: `Quitar a ${nombreDe('supervisor2')}`,
            }),
          ).toHaveCount(0)
          await elegir(
            page,
            'Elegir coordinador preferencial',
            nombreDe('supervisor1'),
          )
          await bloque.getByRole('button', { name: 'Agregar' }).click()
          await expect(bloque).toContainText('Esta sede')
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('sin capacidades', () => {
  test.use({ storageState: storageStatePath('adminSinCapacidades') })

  test(
    'CJ-03, CJ-32: sin manage_supervisions ni manage_attendance la ficha no ofrece agregar preferencias ni corregir jornadas',
    cubre('RB-A04', 'RB-A07', 'CB-17', 'CJ-03', 'CJ-32'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const ayer = daysFromToday(-1)
        const dia =
          ayer.slice(0, 7) === todayAR().slice(0, 7) ? ayer : todayAR()
        await sc.jornadaDirecta('supervisor1', dia, {
          desde: '00:00',
          hasta: '00:30',
        })
        await page.goto(
          `/admin/empleados/${readId('supervisor1')}?pestana=preferenciales`,
        )
        await expect(page.getByRole('tab', { name: 'Jornadas' })).toBeVisible()
        await expect(
          page.getByRole('combobox', { name: 'Elegir cliente preferencial' }),
        ).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Agregar' })).toHaveCount(
          0,
        )

        await page.getByRole('tab', { name: 'Jornadas' }).click()
        await expect(page.getByRole('article').first()).toBeVisible()
        for (const nombre of [
          'Registrar jornada',
          'Agregar pausa',
          /^Corregir hora/,
          /^Quitar la pausa/,
        ]) {
          await expect(page.getByRole('button', { name: nombre })).toHaveCount(
            0,
          )
        }
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('jornadas del coordinador en la ficha', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'CJ-17, CJ-31, CJ-32: la jornada cerrada sola lleva la advertencia; las cuatro correcciones piden motivo, dejan la traza y la quitan',
    cubre('RB-A07', 'RB-A08', 'CJ-13', 'CJ-17', 'CJ-31', 'CJ-32'),
    async ({ page }) => {
      test.skip(
        Number(todayAR().slice(8)) <= 3,
        'Los primeros días del mes las fechas de prueba caen en el mes anterior: se saltea explícito.',
      )
      test.setTimeout(300_000)
      const sc = new Scenario()
      try {
        const dia = daysFromToday(-1)
        const otroDia = daysFromToday(-2)
        const { workdayId } = await sc.jornadaDirecta('supervisor1', dia, {
          desde: '08:00',
          hasta: '23:55',
          autoCerrada: true,
        })

        await page.goto(
          `/admin/empleados/${readId('supervisor1')}?pestana=jornadas`,
        )
        const tarjeta = page.getByRole('article').first()
        await expect(tarjeta).toBeVisible()

        await test.step('CJ-31: «Cerrada automáticamente» con la advertencia y las horas del 08:00 al 23:55', async () => {
          await expect(tarjeta.getByRole('alert')).toContainText(
            'Cerrada automáticamente.',
          )
          await expect(tarjeta).toContainText('15 h 55 min')
          await expect(tarjeta).toContainText('Sin pausas')
          await expect(
            page.getByText(/se cerró sola y todavía no se corrigió/),
          ).toBeVisible()
        })

        await test.step('corrección 1: «Corregir hora» del fin pide motivo y quita la advertencia', async () => {
          await tarjeta
            .getByRole('button', { name: /^Corregir hora: fin de la jornada/ })
            .click()
          const dialogo = page.getByRole('dialog', {
            name: /^Corregir hora: fin de la jornada/,
          })
          await dialogo.getByLabel('Hora nueva').fill(`${dia}T18:00`)
          await dialogo
            .getByRole('button', { name: 'Corregir hora', exact: true })
            .click()
          // El motivo es obligatorio.
          await expect(dialogo.getByRole('alert').first()).toBeVisible()
          await dialogo
            .getByLabel('Motivo')
            .fill('e2e-jornada: terminó a las 18:00 y no finalizó')
          await dialogo
            .getByRole('button', { name: 'Corregir hora', exact: true })
            .click()
          await expect(
            page.getByText('Corregimos la hora: fin de la jornada.'),
          ).toBeVisible()
          await expect(
            tarjeta.getByText('Corregida', { exact: true }),
          ).toBeVisible()
          await expect(tarjeta.getByRole('alert')).toHaveCount(0)
          await expect(tarjeta).toContainText('10 h')
          await expect(tarjeta).toContainText('Historial de correcciones')
          await expect(tarjeta).toContainText(
            'Motivo: e2e-jornada: terminó a las 18:00 y no finalizó',
          )
          const { data: jornada } = await sc.db
            .from('supervisor_workdays')
            .select('corrected, auto_closed, ended_at')
            .eq('id', workdayId)
            .single()
          expect(jornada?.corrected).toBe(true)
          expect(
            jornada?.auto_closed,
            'queda la constancia del cierre automático',
          ).toBe(true)
          expect(new Date(jornada!.ended_at!).getTime()).toBe(
            new Date(`${dia}T18:00:00-03:00`).getTime(),
          )
          const { data: traza } = await sc.db
            .from('security_events')
            .select('event_type')
            .eq('event_type', 'workday_corrected')
            .gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString())
          expect((traza ?? []).length).toBeGreaterThan(0)
        })

        await test.step('corrección 2: «Agregar pausa» con las dos horas, el motivo de la pausa y el de la corrección', async () => {
          await tarjeta.getByRole('button', { name: 'Agregar pausa' }).click()
          const dialogo = page.getByRole('dialog', { name: 'Agregar pausa' })
          await dialogo.getByLabel('Desde').fill(`${dia}T12:00`)
          await dialogo.getByLabel('Hasta').fill(`${dia}T12:30`)
          await dialogo
            .getByLabel('Motivo de la pausa (opcional)')
            .fill('almuerzo')
          await dialogo
            .getByLabel('Motivo de la corrección')
            .fill('e2e-jornada: almorzó y no lo registró')
          await dialogo.getByRole('button', { name: 'Agregar pausa' }).click()
          await expect(page.getByText('Agregamos la pausa.')).toBeVisible()
          await expect(tarjeta).toContainText('12:00 a 12:30')
          await expect(tarjeta).toContainText('almuerzo')
          // 08:00 a 18:00 son 10 h; sin los 30 min de pausa quedan 9 h 30 min.
          await expect(tarjeta).toContainText('9 h 30 min')
        })

        await test.step('corrección 3: «Quitar pausa» pide motivo y la pausa queda dada de baja (no se borra)', async () => {
          await tarjeta
            .getByRole('button', { name: /^Quitar la pausa de las 12:00/ })
            .click()
          const dialogo = page.getByRole('dialog', { name: 'Quitar pausa' })
          await dialogo
            .getByLabel('Motivo')
            .fill('e2e-jornada: no hizo la pausa')
          await dialogo.getByRole('button', { name: 'Quitar pausa' }).click()
          await expect(page.getByText('Quitamos la pausa.')).toBeVisible()
          await expect(tarjeta).toContainText('Sin pausas')
          await expect(tarjeta).toContainText('Pausa dada de baja')
          const { data } = await sc.db
            .from('supervisor_workday_events')
            .select('kind, removed_at, correction_reason')
            .eq('workday_id', workdayId)
            .eq('kind', 'pause')
          expect(data).toHaveLength(1)
          expect(data![0].removed_at).not.toBeNull()
          expect(data![0].correction_reason).toBe(
            'e2e-jornada: no hizo la pausa',
          )
        })

        await test.step('corrección 4: «Registrar jornada» en nombre del coordinador para otro día', async () => {
          await page.getByRole('button', { name: 'Registrar jornada' }).click()
          const dialogo = page.getByRole('dialog', {
            name: new RegExp(
              `^Registrar jornada de ${nombreDe('supervisor1')}`,
            ),
          })
          await dialogo.getByLabel('Inicio').fill(`${otroDia}T09:00`)
          await dialogo
            .getByLabel('Fin (opcional hoy)')
            .fill(`${otroDia}T13:00`)
          await dialogo
            .getByRole('button', { name: 'Registrar jornada', exact: true })
            .click()
          await expect(dialogo.getByRole('alert').first()).toBeVisible()
          await dialogo
            .getByLabel('Motivo')
            .fill('e2e-jornada: se olvidó de iniciarla')
          await dialogo
            .getByRole('button', { name: 'Registrar jornada', exact: true })
            .click()
          await expect(page.getByText('Registramos la jornada.')).toBeVisible()
          await expect(page.getByRole('article')).toHaveCount(2)
          await expect(
            page.getByRole('article').filter({ hasText: '4 h' }).first(),
          ).toContainText('Corregida')
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('supervisión «Sin cerrar» por el cierre automático', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'CJ-14, CJ-31: la supervisión que la jornada dejó abierta figura «Sin cerrar» en Supervisiones y en la ficha, y la administración la cancela',
    cubre('RB-A09', 'RB-S02', 'CJ-14', 'CJ-31'),
    async ({ page }) => {
      test.skip(
        Number(todayAR().slice(8)) <= 3,
        'Los primeros días del mes las fechas de prueba caen en el mes anterior: se saltea explícito.',
      )
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const dia = daysFromToday(-1)
        const cliente = await sc.client('sin-cerrar')
        const sede = await sc.site(cliente.id, 'sin-cerrar')
        const turno = await sc.shift(cliente.id, sede.id, dia, FRANJAS.manana)
        const { supervisionId } = await sc.jornadaDirecta('supervisor1', dia, {
          desde: '08:00',
          hasta: '23:55',
          autoCerrada: true,
          turnoSinCerrar: { shiftId: turno, desde: '10:00' },
        })

        await test.step('ficha del coordinador → Jornadas: la supervisión «Sin cerrar» con su duración informativa', async () => {
          await page.goto(
            `/admin/empleados/${readId('supervisor1')}?pestana=jornadas`,
          )
          const tarjeta = page.getByRole('article').first()
          await expect(tarjeta).toContainText(sede.name)
          await expect(tarjeta).toContainText('Sin cerrar')
          await expect(tarjeta).toContainText('informativa')
        })

        await test.step('ADM-15: el detalle lo marca «Sin cerrar» y «Quitar» lo cancela con motivo', async () => {
          await page.goto(`/admin/supervisiones/${supervisionId}`)
          const detalle = page.getByRole('dialog', {
            name: 'Detalle de la supervisión',
          })
          await expect(detalle).toContainText('Sin cerrar')
          await detalle
            .getByRole('button', { name: /Quitar|Cancelar/ })
            .first()
            .click()
          const confirmar = page
            .getByRole('dialog')
            .filter({ has: page.getByLabel('Motivo') })
            .last()
          await confirmar
            .getByLabel('Motivo')
            .fill('e2e-jornada: se cerró sola')
          await confirmar
            .getByRole('button', {
              name: /Cancelar supervisión|Quitar|Confirmar/,
            })
            .last()
            .click()
          await expect
            .poll(async () => {
              const { data } = await sc.db
                .from('supervisions')
                .select('status')
                .eq('id', supervisionId!)
                .single()
              return data?.status
            })
            .toBe('cancelled')
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'CJ-17, CJ-32: la administración corrige el fin de una jornada cerrada sola que dejó una supervisión «Sin cerrar»',
    cubre('RB-A07', 'CJ-17', 'CJ-31', 'CJ-32'),
    async () => {
      // DEFECTO (mayor): `app.auto_close_workdays` registra `supervision_end` y `end` en las 23:55, y
      // `app.assert_workday_consistent` rechaza un `end` anterior a un `supervision_end`
      // (INVALID_EVENT_ORDER); los eventos de supervisión no se corrigen (EVENT_NOT_CORRECTABLE) y
      // cancelar la supervisión no los baja. La administración no puede mover el fin a la hora real
      // en ese caso. Se saca el `fail` cuando se pueda.
      test.fail(
        true,
        'Defecto: no se puede corregir el fin de una jornada cerrada sola con una supervisión «Sin cerrar».',
      )
      test.info().annotations.push({
        type: 'defecto',
        description:
          'admin_correct_workday_event da INVALID_EVENT_ORDER al llevar el fin antes del supervision_end del cierre automático.',
      })
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const dia = daysFromToday(-1)
        const cliente = await sc.client('sin-cerrar-corregir')
        const sede = await sc.site(cliente.id, 'sin-cerrar-corregir')
        const turno = await sc.shift(cliente.id, sede.id, dia, FRANJAS.manana)
        const { workdayId } = await sc.jornadaDirecta('supervisor1', dia, {
          desde: '08:00',
          hasta: '23:55',
          autoCerrada: true,
          turnoSinCerrar: { shiftId: turno, desde: '10:00' },
        })
        const { data: fin } = await sc.db
          .from('supervisor_workday_events')
          .select('id')
          .eq('workday_id', workdayId)
          .eq('kind', 'end')
          .single()
        const dueno = await sessionClient('owner')
        const respuesta = await dueno.rpc('admin_correct_workday_event', {
          p_event_id: fin!.id,
          p_reason: 'e2e-jornada: terminó a las 18:00',
          p_new_time: `${dia}T18:00:00-03:00`,
        })
        expect(respuesta.error?.message).toBeUndefined()
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('Resumen, Asistencia e imprimible', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'CJ-22, CJ-31, CJ-33: el Resumen muestra la jornada abierta y la cerrada sola; Asistencia de hoy suma la sección «Coordinadores»',
    cubre('RB-A06', 'RB-A07', 'CJ-13', 'CJ-22', 'CJ-31', 'CJ-33'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        await sc.asegurarJornada('supervisor1')
        // Cerrada sola hoy a primera hora (00:00 a 00:01): existe a cualquier hora del día.
        await sc.jornadaDirecta('supervisor2', sc.today, {
          desde: '00:00',
          hasta: '00:01',
          autoCerrada: true,
        })

        await test.step('ADM-02: «Jornadas abiertas» y «Cerradas automáticamente»', async () => {
          await page.goto('/admin')
          const bloque = page.getByRole('region', {
            name: 'Supervisiones de hoy',
          })
          await expect(bloque).toContainText('Jornadas abiertas')
          await expect(bloque).toContainText(nombreDe('supervisor1'))
          await expect(bloque).toContainText('En actividad')
          await expect(bloque).toContainText('Cerradas automáticamente')
          await expect(bloque).toContainText(nombreDe('supervisor2'))
        })

        await test.step('ADM-10: la sección «Coordinadores» con el estado, el inicio, el fin y la novedad', async () => {
          await page.goto('/admin/asistencia')
          const seccion = page.getByRole('region', { name: 'Coordinadores' })
          await expect(seccion).toBeVisible()
          const activo = seccion
            .getByRole('row')
            .filter({ hasText: nombreDe('supervisor1') })
          await expect(activo).toContainText('En actividad')
          const cerrada = seccion
            .getByRole('row')
            .filter({ hasText: nombreDe('supervisor2') })
          await expect(cerrada).toContainText('Finalizada')
          await expect(cerrada).toContainText(
            'Se cerró sola: revisá el horario de fin',
          )
          await expect(
            activo.getByRole('link', { name: nombreDe('supervisor1') }),
          ).toHaveAttribute('href', /pestana=jornadas/)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'CJ-19, CJ-34: «Descargar detalle» del coordinador trae sus jornadas con pausas, supervisiones, total y el pie de firmas; con los dos roles, una sección por rol y la suma',
    cubre('RB-A06', 'RB-A07', 'CJ-13', 'CJ-14', 'CJ-19', 'CJ-34'),
    async ({ page }) => {
      test.skip(
        Number(todayAR().slice(8)) <= 3,
        'Los primeros días del mes las fechas de prueba caen en el mes anterior: se saltea explícito.',
      )
      test.setTimeout(300_000)
      const sc = new Scenario()
      try {
        const dia = daysFromToday(-1)
        const cliente = await sc.client('imprimible')
        const sede = await sc.site(cliente.id, 'imprimible')
        const turno = await sc.shift(cliente.id, sede.id, dia, FRANJAS.manana)
        await sc.jornadaDirecta('supervisor1', dia, {
          desde: '08:00',
          hasta: '16:00',
          pausas: [{ desde: '12:00', hasta: '12:30', motivo: 'almuerzo' }],
        })
        await sc.supervisionDirecta(turno, 'supervisor1', {
          estado: 'completada',
          inicio: `${dia}T10:00:00-03:00`,
          fin: `${dia}T10:45:00-03:00`,
        })

        await test.step('solo coordinador: «Detalle de jornadas» con 7 h 30 min netas y las firmas', async () => {
          await page.goto(
            `/admin/empleados/${readId('supervisor1')}?pestana=asistencia`,
          )
          await page.getByRole('button', { name: 'Descargar detalle' }).click()
          const hoja = page.getByTestId('print-sheet')
          await expect(hoja).toBeVisible()
          await expect(hoja).toContainText('Detalle de jornadas')
          await expect(hoja).toContainText(nombreDe('supervisor1'))
          await expect(hoja).toContainText('7 h 30 min')
          await expect(hoja).toContainText('Total del período')
          await expect(hoja).toContainText(
            'Las partes prestan conformidad con el detalle de jornadas y horas consignado.',
          )
          await expect(hoja.locator('[data-print-signatures]')).toBeVisible()
          await expect(hoja.locator('[data-print-signatures]')).toContainText(
            'Coordinador',
          )
          await page.keyboard.press('Escape')
          await expect(hoja).toBeHidden()
        })

        await test.step('CJ-34: con los dos roles, una sección por rol, su total y la suma al final', async () => {
          const cliente2 = await sc.client('imprimible-dual')
          const sede2 = await sc.site(cliente2.id, 'imprimible-dual')
          await cargarJornada(sc, {
            cliente: cliente2,
            sede: sede2,
            fecha: dia,
            franja: { start: '08:00', end: '11:00' },
            quien: 'dual',
            entrada: '08:00',
            salida: '11:00',
          })
          await sc.jornadaDirecta('dual', dia, {
            desde: '14:00',
            hasta: '16:00',
          })
          await page.goto(
            `/admin/empleados/${readId('dual')}?pestana=asistencia`,
          )
          await page.getByRole('button', { name: 'Descargar detalle' }).click()
          const hoja = page.getByTestId('print-sheet')
          await expect(hoja).toContainText('Detalle de asistencia y jornadas')
          await expect(hoja).toContainText('Total como coordinador')
          await expect(hoja).toContainText('2 h')
          await expect(hoja).toContainText(/Total/)
          await expect(hoja.locator('[data-print-signatures]')).toContainText(
            'Coordinador y empleado',
          )
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('CJ-01: ya no existe «Asignar supervisión»', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'ni en Supervisiones, ni en el detalle del turno, ni en el calendario; la ruta vieja no abre la pantalla',
    cubre('RB-A04', 'RB-A06', 'RB-S02', 'CJ-01'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('sin-asignar')
        const sede = await sc.site(cliente.id, 'sin-asignar')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS.tarde,
        )
        await sc.assign(turno, 'empleado1')

        await page.goto('/admin/supervisiones')
        await expect(
          page.getByRole('combobox', { name: 'Filtrar por coordinador' }),
        ).toBeVisible()
        await page.goto(`/admin/turnos/${turno}`)
        await expect(
          page.getByRole('dialog', { name: 'Detalle del turno' }),
        ).toBeVisible()
        await page.goto(`/admin/planificacion?vista=dia&fecha=${sc.today}`)
        await expect(
          page.getByRole('row').filter({ hasText: cliente.name }),
        ).toBeVisible()
        await page.goto('/admin/supervisiones/nueva')
        for (const raiz of [
          '/admin/supervisiones',
          `/admin/turnos/${turno}`,
          `/admin/planificacion?vista=dia&fecha=${sc.today}`,
        ]) {
          await page.goto(raiz)
          await expect(page.getByRole('heading').first()).toBeVisible()
          await expect(
            page.getByRole('link', {
              name: /Asignar (supervisión|coordinador)/,
            }),
          ).toHaveCount(0)
          await expect(
            page.getByRole('button', {
              name: /Asignar (supervisión|coordinador)/,
            }),
          ).toHaveCount(0)
        }
        await page.goto('/admin/supervisiones/nueva')
        await expect(
          page.getByRole('heading', { name: 'Asignar supervisión' }),
        ).toHaveCount(0)
        await expectNoHorizontalScroll(page)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
