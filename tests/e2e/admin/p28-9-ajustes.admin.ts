import { expect, test, type Page } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import {
  daysFromToday,
  isTooCloseToMidnight,
  mondayOf,
  addDays,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import {
  of05bDotacionYDia,
  of08bLicenciaConTurnos,
  of21CancelarYSinDuplicados,
  of21RepetirIgual,
  of21SacarFechas,
  of22DetalleDeAsistencia,
  of22ResumenDelCliente,
  of22SinCierreAutomaticoNoHayNota,
} from './p28-9-pasos.ts'

// P28.9c: ajustes después del pase de P28 (migración 0084, escritorio 1280 px). La versión de
// 390 px está en p28-9-ajustes.movil.admin.ts.
//   - OF-21: «Repetir este turno» avisa los duplicados («Sacar esas fechas» / «Repetir igual»).
//   - OF-22: «*» y nota al pie en las hojas imprimibles con un cierre automático.
//   - OF-23: «Solo a…» → «Crear un turno nuevo…» en el cronograma, con «Deshacer» solo para la dirección.
//   - OF-05b: editar solo la dotación del servicio no crea turnos.
//   - OF-08b: licencia sobre días con turnos → servicio y «Ver turno».
// Empleados: empleado1 y empleado2 (los otros p28-* usan empleado3 y empleado4).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

// ---------------------------------------------------------------------------------------------
test.describe('OF-21 · repetir un turno avisa duplicados', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    '«Sacar esas fechas» no crea la fecha duplicada y sí las otras, en una sola serie',
    cubre('RB-A04', 'OF-21', 'CB-02'),
    async ({ page }) => {
      test.setTimeout(240_000)
      await of21SacarFechas(page)
    },
  )

  test(
    '«Repetir igual» crea toda la serie, también la fecha que ya tenía turno',
    cubre('RB-A04', 'OF-21', 'CB-02'),
    async ({ page }) => {
      test.setTimeout(240_000)
      await of21RepetirIgual(page)
    },
  )

  test(
    '«Cancelar» no crea nada, y una sede sin duplicados crea la serie sin preguntar',
    cubre('RB-A04', 'OF-21'),
    async ({ page }) => {
      test.setTimeout(240_000)
      await of21CancelarYSinDuplicados(page)
    },
  )
})

// ---------------------------------------------------------------------------------------------
test.describe('OF-22 · cierre automático en las hojas imprimibles', () => {
  test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)
  test.use({ storageState: storageStatePath('admin') })

  test(
    'detalle de asistencia de la persona: «*» en el fin del cierre automático y nota al pie',
    cubre('RB-A06', 'RB-A08', 'CB-05', 'OF-22', 'OF-11'),
    async ({ page }) => {
      test.setTimeout(240_000)
      await of22DetalleDeAsistencia(page)
    },
  )

  test(
    'resumen de servicios del cliente: «*» solo en la fila del cierre automático y una nota al pie',
    cubre('RB-A06', 'RB-A08', 'CB-05', 'OF-22', 'OF-11'),
    async ({ page }) => {
      test.setTimeout(240_000)
      await of22ResumenDelCliente(page)
    },
  )

  test(
    'sin ningún cierre automático la hoja no lleva «*» ni nota',
    cubre('RB-A06', 'OF-22'),
    async ({ page }) => {
      test.setTimeout(240_000)
      await of22SinCierreAutomaticoNoHayNota(page)
    },
  )
})

// ---------------------------------------------------------------------------------------------
// OF-23 · cronograma semanal: «Solo a…» → «Crear un turno nuevo…»
// ---------------------------------------------------------------------------------------------
const LUNES = mondayOf(daysFromToday(7))
const dia = (n: number) => addDays(LUNES, n)

async function abrirSemana(page: Page, quien: 'empleado1' | 'empleado2') {
  await page.goto(`/admin/empleados/${readId(quien)}?pestana=cronograma`)
  await page.getByRole('radio', { name: 'Semana (editar)' }).click()
  await expect(page.getByTestId('cronograma-semana')).toBeVisible()
  await page.getByRole('button', { name: 'Semana siguiente' }).click()
}

/** Turno de dos personas (08:00–10:00, empleado1 y empleado2), del que se pasa a empleado1. */
async function turnoDeDos(sc: Scenario, conServicio: boolean) {
  const cliente = await sc.client('of23')
  const sede = await sc.site(cliente.id, 'of23')
  const servicio = conServicio
    ? await sc.service(cliente.id, sede.id, 'of23', {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        status: 'paused',
      })
    : null
  const turno = await sc.shift(
    cliente.id,
    sede.id,
    dia(1),
    { start: '08:00', end: '10:00' },
    2,
    servicio ? { serviceId: servicio.id } : {},
  )
  await sc.assign(turno, 'empleado1')
  await sc.assign(turno, 'empleado2')
  return { cliente, sede, turno }
}

/** Mueve el bloque 2 horas abajo (8 × 15 min) y elige «Solo a…» → «Crear un turno nuevo…». */
async function pasarSoloAUnTurnoNuevo(
  page: Page,
  sedeNombre: string,
  quien: 'empleado1',
) {
  const bloque = page
    .getByTestId('bloque')
    .filter({ has: page.getByText(sedeNombre, { exact: true }) })
  await expect(bloque).toBeVisible()
  await bloque.focus()
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  const dialogo = page.getByRole('dialog')
  await expect(
    dialogo.getByRole('heading', {
      name: /¿Mover el turno para todos o pasar solo a/,
    }),
  ).toBeVisible()
  await dialogo.getByRole('combobox').click()
  const opcion = page.getByRole('option', { name: /^Crear un turno nuevo en / })
  await expect(opcion).toContainText(sedeNombre)
  await expect(opcion).toContainText('de 10:00 a 12:00')
  await expect(opcion).toContainText(`pasar a ${nombreDe(quien)}`)
  await opcion.click()
  await dialogo
    .getByRole('button', { name: new RegExp(`^Solo a ${nombreDe(quien)}`) })
    .click()
  await expect(
    page.getByText(
      `Creamos un turno nuevo en ${sedeNombre} y pasamos a ${nombreDe(quien)}.`,
    ),
  ).toBeVisible()
}

async function asignacionVigente(
  sc: Scenario,
  quien: 'empleado1' | 'empleado2',
) {
  const { data, error } = await sc.db
    .from('assignments')
    .select('id, shift_id')
    .eq('employee_id', readId(quien))
    .is('removed_at', null)
    .in(
      'shift_id',
      (
        await sc.db.from('shifts').select('id').in('client_id', sc.clientIds)
      ).data!.map((s) => s.id),
    )
  expect(error, error?.message).toBeNull()
  return data ?? []
}

test.describe('OF-23 · «Solo a…» crea el turno destino (cronograma)', () => {
  test.describe('la dirección', () => {
    test.use({ storageState: storageStatePath('owner') })

    test(
      'turno con 2 asignados: la persona pasa a un turno manual nuevo del mismo día, queda sin servicio, y «Deshacer» la devuelve y borra el turno',
      cubre('RB-A04', 'RB-A06', 'OF-23', 'OF-10', 'CB-02'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          const { sede, turno } = await turnoDeDos(sc, true)
          await abrirSemana(page, 'empleado1')
          await pasarSoloAUnTurnoNuevo(page, sede.name, 'empleado1')

          const nuevo = await expect
            .poll(
              async () =>
                (await asignacionVigente(sc, 'empleado1'))[0]?.shift_id,
            )
            .not.toBe(turno)
            .then(
              async () =>
                (await asignacionVigente(sc, 'empleado1'))[0].shift_id,
            )
          const { data: t } = await sc.db
            .from('shifts')
            .select(
              'site_id, shift_date, start_time, end_time, required_staff, generated, service_id',
            )
            .eq('id', nuevo)
            .single()
          expect(t?.site_id).toBe(sede.id)
          expect(t?.shift_date).toBe(dia(1))
          expect(t?.start_time.slice(0, 5)).toBe('10:00')
          expect(t?.end_time.slice(0, 5)).toBe('12:00')
          expect(t?.required_staff).toBe(1)
          expect(t?.generated).toBe(false)
          // El servicio ya tenía turno ese día: el nuevo nace manual, sin servicio.
          expect(t?.service_id).toBeNull()
          // El otro asignado sigue en el turno de origen.
          const otra = await asignacionVigente(sc, 'empleado2')
          expect(otra.map((a) => a.shift_id)).toEqual([turno])

          await test.step('«Deshacer» devuelve a la persona y borra el turno creado', async () => {
            await page.getByRole('button', { name: 'Deshacer' }).click()
            await expect(page.getByText('Deshicimos el cambio.')).toBeVisible()
            await expect
              .poll(
                async () =>
                  (await asignacionVigente(sc, 'empleado1'))[0]?.shift_id,
              )
              .toBe(turno)
            const { data: borrado } = await sc.db
              .from('shifts')
              .select('id')
              .eq('id', nuevo)
              .is('deleted_at', null)
            expect(borrado, 'el turno creado ya no existe').toEqual([])
          })
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )

    test(
      'cancelar el diálogo no crea ningún turno',
      cubre('RB-A04', 'OF-23'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          const { sede, turno } = await turnoDeDos(sc, false)
          await abrirSemana(page, 'empleado1')
          const bloque = page
            .getByTestId('bloque')
            .filter({ has: page.getByText(sede.name, { exact: true }) })
          await bloque.focus()
          for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown')
          await page.keyboard.press('Enter')
          const dialogo = page.getByRole('dialog')
          await dialogo.getByRole('combobox').click()
          await page
            .getByRole('option', { name: /^Crear un turno nuevo en / })
            .click()
          await dialogo.getByRole('button', { name: 'Cancelar' }).click()
          await expect(dialogo).toBeHidden()
          const { data } = await sc.db
            .from('shifts')
            .select('id')
            .eq('site_id', sede.id)
            .is('deleted_at', null)
          expect(data?.map((s) => s.id)).toEqual([turno])
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })

  test.describe('un administrador', () => {
    test.use({ storageState: storageStatePath('admin') })

    test(
      'pasa a la persona al turno nuevo pero el aviso no ofrece «Deshacer» (borrar el turno es de la dirección)',
      cubre('RB-A04', 'RB-X02', 'OF-23', 'CB-17'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          const { sede, turno } = await turnoDeDos(sc, false)
          await abrirSemana(page, 'empleado1')
          await pasarSoloAUnTurnoNuevo(page, sede.name, 'empleado1')
          await expect
            .poll(
              async () =>
                (await asignacionVigente(sc, 'empleado1'))[0]?.shift_id,
            )
            .not.toBe(turno)
          await expect(
            page.getByRole('button', { name: 'Deshacer' }),
          ).toHaveCount(0)
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })
})

// ---------------------------------------------------------------------------------------------
test.describe('OF-05b · cambio solo de dotación no crea turnos', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'solo dotación: «No se crean turnos nuevos» y no se crean; agregando un día, el diálogo promete crear',
    cubre('RB-A04', 'P-044', 'OF-05', 'OF-05b'),
    async ({ page }) => {
      test.setTimeout(240_000)
      await of05bDotacionYDia(page)
    },
  )
})

// ---------------------------------------------------------------------------------------------
test.describe('OF-08b · licencia sobre días con turnos', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'las filas muestran el servicio (o «Turno cargado a mano») y «Ver turno» lleva al turno',
    cubre('RB-A03', 'OF-08', 'OF-08b'),
    async ({ page }) => {
      test.setTimeout(240_000)
      await of08bLicenciaConTurnos(page)
    },
  )
})
