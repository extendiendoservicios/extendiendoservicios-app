// tests/e2e/admin/p28-9-pasos.ts — P28.9c
//
// Cuerpos de prueba compartidos entre el proyecto `chromium` (p28-9-ajustes.admin.ts) y el proyecto
// `mobile` (p28-9-ajustes.movil.admin.ts). No termina en `.admin.ts`: Playwright no lo toma como
// archivo de pruebas.
//
// Empleados de P28.9c: empleado1 y empleado2 (los otros p28-* usan empleado3 y empleado4), para
// que dos archivos en paralelo no se pisen los horarios.

import { expect, test, type Page } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import { addDays, daysFromToday, FRANJAS } from '../../fixtures/dates.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { readId } from '../../fixtures/sessions.ts'
import { ejecutarSqlEnAppDev } from '../../fixtures/sql.ts'
import { expectNoHorizontalScroll, pickDate } from '../../fixtures/ui.ts'
import { darDeBajaLicencias } from '../../e2e-ajustes-reunion/helpers/dia.ts'
import { cargarJornada } from '../../e2e-ajustes-reunion/helpers/historial.ts'

const partes = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

// ---------------------------------------------------------------------------------------------
// OF-21 · «Repetir este turno» avisa duplicados
// ---------------------------------------------------------------------------------------------

/** Turnos de la sede (sin los borrados), con fecha y horario, ordenados. */
async function turnosDeLaSede(sc: Scenario, siteId: string) {
  const { data, error } = await sc.db
    .from('shifts')
    .select('id, shift_date, start_time, end_time')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .order('shift_date')
  expect(error, error?.message).toBeNull()
  return data ?? []
}

/**
 * Prepara la sede con un turno YA cargado a mano en la fecha del medio de una repetición semanal
 * de tres fechas (D, D+7, D+14) y deja el formulario listo para crear. Devuelve lo que los pasos
 * siguientes necesitan.
 */
async function prepararRepeticion(page: Page, sc: Scenario, slug: string) {
  const cliente = await sc.client(slug)
  const sede = await sc.site(cliente.id, slug)
  const d0 = daysFromToday(21)
  const d1 = addDays(d0, 7)
  const d2 = addDays(d0, 14)
  // Turno manual ya cargado el D+7, de 09:00 a 11:00: se pisa con el 08:00–10:00 de la repetición.
  const yaCargado = await sc.shift(cliente.id, sede.id, d1, {
    start: '09:00',
    end: '11:00',
  })
  await page.goto(`/admin/turnos/nuevo?fecha=${d0}`)
  await page.getByRole('combobox', { name: 'Cliente' }).click()
  await page.getByRole('option', { name: cliente.name }).click()
  await page.getByRole('combobox', { name: 'Sede' }).click()
  await page.getByRole('option', { name: sede.name }).click()
  await page.getByLabel('Desde').first().fill('08:00')
  await page.getByLabel('Hasta').first().fill('10:00')
  await page.locator('#shift-repeat').click()
  // Los feriados no deben cambiar el resultado de la prueba.
  await page.locator('#shift-works-on-holidays').click()
  await pickDate(page, 'Repetir hasta', partes(d2))
  await expect(page.getByLabel('Repetir hasta')).toContainText(/\d/)
  return { cliente, sede, d0, d1, d2, yaCargado }
}

async function enviarRepeticion(page: Page) {
  await page
    .getByRole('button', { name: /^(Crear turnos?|Guardar)/ })
    .last()
    .click()
}

export async function of21SacarFechas(page: Page): Promise<void> {
  const sc = new Scenario()
  try {
    const { sede, d0, d1, d2, yaCargado } = await prepararRepeticion(
      page,
      sc,
      'of21a',
    )
    await enviarRepeticion(page)
    const dialogo = page.getByRole('dialog', {
      name: 'Posibles turnos duplicados',
    })
    await expect(dialogo).toBeVisible()
    // Una sola línea (la del D+7), con el horario del turno que ya estaba y «cargado a mano».
    await expect(dialogo.getByRole('listitem')).toHaveCount(1)
    await expect(dialogo.getByRole('listitem')).toContainText(
      /ya hay un turno cargado a mano de 09:00 a 11:00/,
    )
    await expectNoHorizontalScroll(page)
    await dialogo.getByRole('button', { name: 'Sacar esas fechas' }).click()
    await expect(dialogo).toBeHidden()
    await expect
      .poll(async () => (await turnosDeLaSede(sc, sede.id)).length, {
        message: 'turnos de la sede tras «Sacar esas fechas»',
      })
      .toBe(3)
    const turnos = await turnosDeLaSede(sc, sede.id)
    // El D y el D+14 son nuevos; el D+7 sigue siendo el que ya estaba (09:00–11:00), sin uno nuevo.
    expect(turnos.map((t) => t.shift_date)).toEqual([d0, d1, d2])
    expect(turnos[0]?.start_time.slice(0, 5)).toBe('08:00')
    expect(turnos[1]?.id).toBe(yaCargado)
    expect(turnos[1]?.start_time.slice(0, 5)).toBe('09:00')
    expect(turnos[2]?.start_time.slice(0, 5)).toBe('08:00')
  } finally {
    expect(await sc.cleanup(), 'limpieza').toEqual([])
  }
}

export async function of21RepetirIgual(page: Page): Promise<void> {
  const sc = new Scenario()
  try {
    const { sede, d0, d1, d2, yaCargado } = await prepararRepeticion(
      page,
      sc,
      'of21b',
    )
    await enviarRepeticion(page)
    const dialogo = page.getByRole('dialog', {
      name: 'Posibles turnos duplicados',
    })
    await expect(dialogo).toBeVisible()
    await dialogo.getByRole('button', { name: 'Repetir igual' }).click()
    await expect
      .poll(async () => (await turnosDeLaSede(sc, sede.id)).length, {
        message: 'turnos de la sede tras «Repetir igual»',
      })
      .toBe(4)
    const turnos = await turnosDeLaSede(sc, sede.id)
    expect(turnos.map((t) => t.shift_date)).toEqual([d0, d1, d1, d2])
    // El D+7 tiene el que ya estaba y uno nuevo de 08:00 a 10:00.
    const delD1 = turnos.filter((t) => t.shift_date === d1)
    expect(delD1.map((t) => t.start_time.slice(0, 5)).sort()).toEqual([
      '08:00',
      '09:00',
    ])
    expect(delD1.some((t) => t.id === yaCargado)).toBe(true)
  } finally {
    expect(await sc.cleanup(), 'limpieza').toEqual([])
  }
}

export async function of21CancelarYSinDuplicados(page: Page): Promise<void> {
  const sc = new Scenario()
  try {
    const { cliente, sede } = await prepararRepeticion(page, sc, 'of21c')
    await enviarRepeticion(page)
    const dialogo = page.getByRole('dialog', {
      name: 'Posibles turnos duplicados',
    })
    await expect(dialogo).toBeVisible()
    await dialogo.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialogo).toBeHidden()
    // Cancelar no crea nada: sigue el turno que ya estaba.
    expect(await turnosDeLaSede(sc, sede.id)).toHaveLength(1)

    // Contraprueba: una sede sin turnos esos días no muestra el diálogo y crea la serie entera.
    const limpia = await sc.site(cliente.id, 'of21c-limpia')
    await page.goto(`/admin/turnos/nuevo?fecha=${daysFromToday(21)}`)
    await page.getByRole('combobox', { name: 'Cliente' }).click()
    await page.getByRole('option', { name: cliente.name }).click()
    await page.getByRole('combobox', { name: 'Sede' }).click()
    await page.getByRole('option', { name: limpia.name }).click()
    await page.getByLabel('Desde').first().fill('08:00')
    await page.getByLabel('Hasta').first().fill('10:00')
    await page.locator('#shift-repeat').click()
    await page.locator('#shift-works-on-holidays').click()
    await pickDate(page, 'Repetir hasta', partes(daysFromToday(35)))
    await enviarRepeticion(page)
    await expect
      .poll(async () => (await turnosDeLaSede(sc, limpia.id)).length)
      .toBe(3)
    await expect(
      page.getByRole('dialog', { name: 'Posibles turnos duplicados' }),
    ).toHaveCount(0)
  } finally {
    expect(await sc.cleanup(), 'limpieza').toEqual([])
  }
}

// ---------------------------------------------------------------------------------------------
// OF-22 · cierre automático en las hojas imprimibles
// ---------------------------------------------------------------------------------------------

const NOTA = '* Cierre automático: no se registró el fin.'

/**
 * Arma un cliente con dos jornadas de hoy: empleado1 en una sede con fichaje de inicio y SIN fin
 * (el cron de cierre automático lo cierra a las 00:01) y empleado2 con inicio y fin fichados a
 * mano (cierre normal). Corre `app.auto_close_assignments()` como lo haría el cron.
 */
async function prepararCierreAutomatico(sc: Scenario, slug: string) {
  const cliente = await sc.client(slug)
  const sedeAuto = await sc.site(cliente.id, `${slug}-auto`)
  const sedeNormal = await sc.site(cliente.id, `${slug}-normal`)
  const turno = await sc.shift(
    cliente.id,
    sedeAuto.id,
    sc.today,
    FRANJAS.madrugada,
  )
  const asignacion = await sc.assign(turno, 'empleado1')
  const empleado = await sessionClient('empleado1')
  const inicio = await empleado.rpc('record_check_in', {
    p_assignment_id: asignacion,
  })
  expect(inicio.error, inicio.error?.message).toBeNull()
  await sc.db
    .from('attendance_records')
    .update({ recorded_at: `${sc.today}T00:00:30-03:00` })
    .eq('assignment_id', asignacion)
    .eq('kind', 'check_in')
  await cargarJornada(sc, {
    cliente,
    sede: sedeNormal,
    fecha: sc.today,
    franja: { start: '08:00', end: '12:00' },
    quien: 'empleado2',
    entrada: '08:00',
    salida: '12:00',
  })
  ejecutarSqlEnAppDev('select app.auto_close_assignments();')
  const { data: fin } = await sc.db
    .from('attendance_records')
    .select('auto_closed')
    .eq('assignment_id', asignacion)
    .eq('kind', 'check_out')
    .single()
  expect(fin?.auto_closed, 'el cron cerró la asignación').toBe(true)
  return { cliente, sedeAuto, sedeNormal }
}

export async function of22DetalleDeAsistencia(page: Page): Promise<void> {
  const sc = new Scenario()
  try {
    const { sedeAuto } = await prepararCierreAutomatico(sc, 'of22a')
    await page.goto(`/admin/empleados/${readId('empleado1')}`)
    await page.getByRole('tab', { name: 'Asistencia' }).click()
    await page.getByRole('button', { name: 'Descargar detalle' }).click()
    const hoja = page.getByRole('dialog', {
      name: new RegExp(`^Detalle de asistencia - ${nombreDe('empleado1')} - `),
    })
    await expect(hoja).toBeVisible()
    const fila = hoja.getByRole('row').filter({ hasText: sedeAuto.name })
    // El fin lo puso el sistema (00:01): lleva «*».
    await expect(fila).toContainText(/00:01\*/)
    await expect(hoja.getByText(NOTA)).toHaveCount(1)
    await expectNoHorizontalScroll(page)
  } finally {
    expect(await sc.cleanup(), 'limpieza').toEqual([])
  }
}

export async function of22ResumenDelCliente(page: Page): Promise<void> {
  const sc = new Scenario()
  try {
    const { cliente, sedeAuto, sedeNormal } = await prepararCierreAutomatico(
      sc,
      'of22b',
    )
    await page.goto(`/admin/clientes/${cliente.id}?pestana=resumen`)
    await expect(
      page.getByRole('region', { name: 'Totales del período' }),
    ).toContainText(/Turnos realizados\s*2/)
    await page.getByRole('button', { name: 'Descargar resumen' }).click()
    const hoja = page.getByRole('dialog', {
      name: new RegExp(`^Resumen de servicios - ${cliente.name} - `),
    })
    await expect(hoja).toBeVisible()
    const auto = hoja.getByRole('row').filter({ hasText: sedeAuto.name })
    const normal = hoja.getByRole('row').filter({ hasText: sedeNormal.name })
    // «*» en las horas del cierre automático y no en las del normal.
    await expect(auto).toContainText('*')
    await expect(normal).not.toContainText('*')
    await expect(hoja.getByText(NOTA)).toHaveCount(1)
  } finally {
    expect(await sc.cleanup(), 'limpieza').toEqual([])
  }
}

export async function of22SinCierreAutomaticoNoHayNota(
  page: Page,
): Promise<void> {
  const sc = new Scenario()
  try {
    const cliente = await sc.client('of22c')
    const sede = await sc.site(cliente.id, 'of22c')
    await cargarJornada(sc, {
      cliente,
      sede,
      fecha: sc.today,
      franja: { start: '08:00', end: '12:00' },
      quien: 'empleado2',
      entrada: '08:00',
      salida: '12:00',
    })
    await page.goto(`/admin/clientes/${cliente.id}?pestana=resumen`)
    await expect(
      page.getByRole('region', { name: 'Totales del período' }),
    ).toContainText(/Turnos realizados\s*1/)
    await page.getByRole('button', { name: 'Descargar resumen' }).click()
    const hoja = page.getByRole('dialog', {
      name: new RegExp(`^Resumen de servicios - ${cliente.name} - `),
    })
    await expect(hoja).toBeVisible()
    await expect(
      hoja.getByRole('row').filter({ hasText: sede.name }),
    ).toBeVisible()
    await expect(hoja.getByText(NOTA)).toHaveCount(0)
    await expect(
      hoja.getByRole('row').filter({ hasText: sede.name }),
    ).not.toContainText('*')
  } finally {
    expect(await sc.cleanup(), 'limpieza').toEqual([])
  }
}

// ---------------------------------------------------------------------------------------------
// OF-05b · cambio solo de dotación no crea turnos
// ---------------------------------------------------------------------------------------------

export async function of05bDotacionYDia(page: Page): Promise<void> {
  const sc = new Scenario()
  try {
    const cliente = await sc.client('of05b')
    const sede = await sc.site(cliente.id, 'of05b')
    // El servicio trabaja todos los días menos uno (el del D+8), así se puede «agregar un día».
    const diaFaltante = new Date(`${daysFromToday(8)}T12:00:00Z`).getUTCDay()
    const servicio = await sc.service(cliente.id, sede.id, 'of05b', {
      weekdays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== diaFaltante),
      staff: 1,
      validFrom: daysFromToday(0),
    })
    const turnos: string[] = []
    for (const d of [4, 5, 6]) {
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
    await sc.db.from('shifts').update({ generated: true }).in('id', turnos)
    const cuantos = async () =>
      (
        await sc.db
          .from('shifts')
          .select('id')
          .eq('service_id', servicio.id)
          .is('deleted_at', null)
      ).data?.length ?? 0

    await page.goto(`/admin/servicios/${servicio.id}/editar`)
    await expect(page.getByLabel('Nombre')).toHaveValue(servicio.name)

    await test.step('solo la dotación: «No se crean turnos nuevos» y no se crea ninguno', async () => {
      await page.getByLabel('Dotación').fill('3')
      await page.getByRole('button', { name: 'Guardar cambios' }).click()
      const dialogo = page.getByRole('dialog')
      await expect(
        dialogo.getByRole('heading', {
          name: /¿Aplicar los cambios a los turnos desde el/,
        }),
      ).toBeVisible()
      await expect(dialogo).toContainText('No se crean turnos nuevos')
      await expect(dialogo).not.toContainText('se crean los que faltan')
      await expect(dialogo).toContainText(/Se actualizan 3 turnos/)
      await dialogo
        .getByRole('button', { name: 'Aplicar', exact: true })
        .click()
      await expect(
        dialogo.getByRole('heading', { name: 'Resultado' }),
      ).toBeVisible()
      await dialogo.getByRole('button', { name: 'Listo' }).click()
      const { data } = await sc.db
        .from('shifts')
        .select('required_staff')
        .in('id', turnos)
      expect(data?.map((t) => t.required_staff)).toEqual([3, 3, 3])
      expect(await cuantos(), 'no se creó ningún turno').toBe(3)
    })

    await test.step('agregar un día: el diálogo promete crear los turnos que faltan', async () => {
      await page.goto(`/admin/servicios/${servicio.id}/editar`)
      await expect(page.getByLabel('Nombre')).toHaveValue(servicio.name)
      await page.locator(`#service-weekday-${diaFaltante}`).click()
      await page.getByRole('button', { name: 'Guardar cambios' }).click()
      const dialogo = page.getByRole('dialog')
      await expect(
        dialogo.getByRole('heading', {
          name: /¿Aplicar los cambios a los turnos desde el/,
        }),
      ).toBeVisible()
      await expect(dialogo).toContainText('se crean los que faltan')
      await expect(dialogo).not.toContainText('No se crean turnos nuevos')
      await expect(dialogo).toHaveCount(1)
      // No se aplica: se cierra sin tocar (la vista previa ya mostró el cambio).
      await dialogo.getByRole('button', { name: 'No aplicar' }).click()
      expect(await cuantos()).toBe(3)
    })
  } finally {
    expect(await sc.cleanup(), 'limpieza').toEqual([])
  }
}

// ---------------------------------------------------------------------------------------------
// OF-08b · licencia sobre días con turnos: servicio y «Ver turno»
// ---------------------------------------------------------------------------------------------

export async function of08bLicenciaConTurnos(page: Page): Promise<void> {
  const sc = new Scenario()
  try {
    const cliente = await sc.client('of08b')
    const sede = await sc.site(cliente.id, 'of08b')
    const servicio = await sc.service(cliente.id, sede.id, 'of08b', {
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      status: 'paused',
    })
    const conServicio = await sc.shift(
      cliente.id,
      sede.id,
      daysFromToday(30),
      { start: '08:00', end: '10:00' },
      1,
      { serviceId: servicio.id },
    )
    const manual = await sc.shift(cliente.id, sede.id, daysFromToday(31), {
      start: '08:00',
      end: '10:00',
    })
    await sc.assign(conServicio, 'empleado1')
    await sc.assign(manual, 'empleado1')
    await page.goto(`/admin/empleados/${readId('empleado1')}`)
    await page.getByRole('tab', { name: 'Licencias' }).click()
    await page.getByLabel('Desde').fill(daysFromToday(29))
    await page.getByLabel('Hasta (opcional)').fill(daysFromToday(32))
    await page.getByLabel('Motivo (opcional)').fill('E2E-P1911 of08b')
    await page.getByRole('button', { name: 'Agregar licencia' }).click()
    const aviso = page.getByText(
      'Esta persona tiene 2 turnos asignados en las fechas de la licencia.',
    )
    await expect(aviso).toBeVisible()
    const lista = page.getByRole('listitem').filter({ hasText: cliente.name })
    await expect(lista).toHaveCount(2)
    const filaServicio = lista.filter({ hasText: servicio.name })
    const filaManual = lista.filter({ hasText: 'Turno cargado a mano' })
    await expect(filaServicio).toHaveCount(1)
    await expect(filaManual).toHaveCount(1)
    await expect(
      filaServicio.getByRole('button', { name: 'Ver turno' }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Abrir turno' })).toHaveCount(0)
    await expectNoHorizontalScroll(page)
    // «Ver turno» navega al detalle del turno que corresponde a cada fila.
    await filaManual.getByRole('button', { name: 'Ver turno' }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/turnos/${manual}$`))
    // En escritorio el detalle es una hoja y en celular una pantalla: en las dos dice «Detalle del turno».
    await expect(page.getByText('Detalle del turno').first()).toBeVisible()
    // Nada se desasignó.
    const { data } = await sc.db
      .from('assignments')
      .select('id')
      .in('shift_id', [conServicio, manual])
      .is('removed_at', null)
    expect(data).toHaveLength(2)
  } finally {
    expect(await darDeBajaLicencias('empleado1'), 'bajas').toEqual([])
    expect(await sc.cleanup(), 'limpieza').toEqual([])
  }
}
