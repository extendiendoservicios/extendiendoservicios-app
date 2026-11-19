import { expect, test, type Page } from '@playwright/test'
import { nombreDe, reNombreDe } from '../../fixtures/accounts.ts'
import { daysFromToday } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// P30.5 · OH-09 «Registrar como realizado» (`register_past_shift`) y OH-10 «Ya hay un turno» con
// salida («Editar ese turno», «Crear igual», «Cancelar»), alta de turnos de `/admin/turnos/nuevo`,
// escritorio 1280 px. Cuentas: empleado4 (OH-09) y empleado3 (OH-10 con asignados).
// Fechas relativas a hoy en hora de Argentina; los turnos pasados son de hace 3 y 4 días.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

async function elegirClienteYSede(page: Page, cliente: string, sede: string) {
  await page.getByRole('combobox', { name: 'Cliente' }).click()
  await page.getByRole('option', { name: cliente }).click()
  await page.getByRole('combobox', { name: 'Sede' }).click()
  await page.getByRole('option', { name: sede }).click()
}

async function horario(page: Page, desde: string, hasta: string) {
  await page.getByLabel('Desde').first().fill(desde)
  await page.getByLabel('Hasta').first().fill(hasta)
}

async function elegirEmpleado(page: Page, quien: 'empleado3' | 'empleado4') {
  await page.getByRole('combobox', { name: 'Empleados del turno' }).click()
  await page.getByRole('option', { name: reNombreDe(quien) }).click()
  await page.keyboard.press('Escape')
}

test.describe('turno pasado: «Registrar como realizado» (OH-09)', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'la fecha pasada avisa «Este turno ya pasó», crea el turno con la asistencia del turno completo y las horas cuentan',
    cubre('RB-A04', 'RB-A06', 'RB-A08', 'OH-09', 'CB-05'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('pasado')
        const sede = await sc.site(cliente.id, 'pasado')
        const fecha = daysFromToday(-3)

        await page.goto(`/admin/turnos/nuevo?fecha=${fecha}`)
        await elegirClienteYSede(page, cliente.name, sede.name)
        await horario(page, '08:00', '10:00')

        await test.step('el formulario lo dice y el botón pasa a «Registrar como realizado»', async () => {
          await expect(
            page.getByText('Este turno ya pasó', { exact: true }),
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: 'Registrar como realizado' }),
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: 'Crear turno' }),
          ).toHaveCount(0)
        })

        await test.step('sin personas no se guarda nada y lo dice', async () => {
          await page
            .getByRole('button', { name: 'Registrar como realizado' })
            .click()
          await expect(
            page.getByText(
              'Elegí al menos una persona: sin asistencia no hay nada que registrar.',
              { exact: true },
            ),
          ).toBeVisible()
          const { data } = await sc.db
            .from('shifts')
            .select('id')
            .eq('site_id', sede.id)
            .is('deleted_at', null)
          expect(data).toHaveLength(0)
        })

        await test.step('con una persona: crea el turno, la asigna y carga inicio y fin con «Carga posterior»', async () => {
          await elegirEmpleado(page, 'empleado4')
          await page
            .getByRole('button', { name: 'Registrar como realizado' })
            .click()
          await expect(
            page.getByText(
              'Registramos el turno como realizado, con la asistencia de 1 persona.',
            ),
          ).toBeVisible()
          const { data: turnos } = await sc.db
            .from('shifts')
            .select('id, status, shift_date, start_time, end_time')
            .eq('site_id', sede.id)
            .is('deleted_at', null)
          expect(turnos).toHaveLength(1)
          const turno = turnos![0]
          sc.extraShiftIds.push(turno.id)
          expect(turno.shift_date).toBe(fecha)
          expect(turno.status).toBe('completed')
          const { data: asignaciones } = await sc.db
            .from('assignments')
            .select('id, employee_id, status')
            .eq('shift_id', turno.id)
            .is('removed_at', null)
          expect(asignaciones?.map((a) => a.employee_id)).toEqual([
            readId('empleado4'),
          ])
          const { data: fichajes } = await sc.db
            .from('attendance_records')
            .select('kind, reason, source, recorded_at, recorded_by')
            .eq('assignment_id', asignaciones![0].id)
            .order('recorded_at')
          expect(fichajes?.map((f) => f.kind)).toEqual([
            'check_in',
            'check_out',
          ])
          expect(fichajes?.every((f) => f.reason === 'Carga posterior')).toBe(
            true,
          )
          expect(fichajes?.every((f) => f.recorded_by !== null)).toBe(true)
          // 08:00 y 10:00 hora de Argentina (UTC-3) = 11:00 y 13:00 UTC.
          expect(fichajes![0].recorded_at.slice(0, 16)).toBe(`${fecha}T11:00`)
          expect(fichajes![1].recorded_at.slice(0, 16)).toBe(`${fecha}T13:00`)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'solo la dirección y la administración con «Gestionar asistencia»: el administrador sin la capacidad ve el aviso de que no puede y el botón queda deshabilitado',
    cubre('RB-A04', 'RB-X02', 'CB-17', 'OH-09'),
    async ({ browser }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      const contexto = await browser.newContext({
        storageState: storageStatePath('adminSinCapacidades'),
      })
      const page = await contexto.newPage()
      try {
        const cliente = await sc.client('pasado-sc')
        const sede = await sc.site(cliente.id, 'pasado-sc')
        await page.goto(`/admin/turnos/nuevo?fecha=${daysFromToday(-4)}`)
        await elegirClienteYSede(page, cliente.name, sede.name)
        await horario(page, '08:00', '10:00')
        await expect(
          page.getByText('Este turno ya pasó', { exact: true }),
        ).toBeVisible()
        await expect(
          page.getByText(
            /ser de la dirección o de la administración con el permiso/,
          ),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Registrar como realizado' }),
        ).toBeDisabled()
        const { data } = await sc.db
          .from('shifts')
          .select('id')
          .eq('site_id', sede.id)
          .is('deleted_at', null)
        expect(data).toHaveLength(0)
      } finally {
        await contexto.close()
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('«Ya hay un turno» con salida (OH-10)', () => {
  test.use({ storageState: storageStatePath('owner') })

  /** Un turno ya cargado a mano (12:30–14:30) con empleado3, en una sede propia. */
  async function turnoExistente(sc: Scenario, slug: string) {
    const cliente = await sc.client(slug)
    const sede = await sc.site(cliente.id, slug)
    const fecha = daysFromToday(11)
    const turno = await sc.shift(cliente.id, sede.id, fecha, {
      start: '12:30',
      end: '14:30',
    })
    await sc.assign(turno, 'empleado3')
    return { cliente, sede, fecha, turno }
  }

  async function intentarSolapado(
    page: Page,
    datos: Awaited<ReturnType<typeof turnoExistente>>,
  ) {
    await page.goto(`/admin/turnos/nuevo?fecha=${datos.fecha}`)
    await elegirClienteYSede(page, datos.cliente.name, datos.sede.name)
    await horario(page, '13:00', '15:00')
    await page.getByRole('button', { name: 'Crear turno' }).click()
    const aviso = page.getByRole('dialog', { name: 'Ya hay un turno' })
    await expect(aviso).toBeVisible()
    return aviso
  }

  test(
    'el aviso muestra el turno que ya existe (fecha, horario, sede y asignados) con los tres botones; «Cancelar» no crea nada',
    cubre('RB-A04', 'OF-02', 'OH-10', 'CB-02'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const datos = await turnoExistente(sc, 'yahay-a')
        const aviso = await intentarSolapado(page, datos)
        const existente = aviso.getByTestId('existing-shift')
        await expect(existente).toBeVisible()
        await expect(existente).toContainText('12:30')
        await expect(existente).toContainText('14:30')
        await expect(existente).toContainText(datos.sede.name)
        await expect(existente).toContainText('Turno cargado a mano')
        await expect(existente).toContainText(nombreDe('empleado3'))
        for (const nombre of ['Editar ese turno', 'Crear igual', 'Cancelar']) {
          await expect(
            aviso.getByRole('button', { name: nombre }),
          ).toBeVisible()
        }
        await aviso.getByRole('button', { name: 'Cancelar' }).click()
        await expect(aviso).toBeHidden()
        const { data } = await sc.db
          .from('shifts')
          .select('id')
          .eq('site_id', datos.sede.id)
          .is('deleted_at', null)
        expect(data?.map((t) => t.id)).toEqual([datos.turno])
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    '«Editar ese turno» lleva a la edición del turno existente, que se corrige en lugar de quedar duplicado',
    cubre('RB-A04', 'OF-02', 'OH-10'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const datos = await turnoExistente(sc, 'yahay-e')
        const aviso = await intentarSolapado(page, datos)
        await aviso.getByRole('button', { name: 'Editar ese turno' }).click()
        await expect(page).toHaveURL(
          new RegExp(`/admin/turnos/${datos.turno}/editar`),
        )
        const { data } = await sc.db
          .from('shifts')
          .select('id')
          .eq('site_id', datos.sede.id)
          .is('deleted_at', null)
        expect(data, 'no se creó un segundo turno').toHaveLength(1)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    '«Crear igual» crea el segundo turno en el horario que se pisa',
    cubre('RB-A04', 'OF-02', 'OH-10'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const datos = await turnoExistente(sc, 'yahay-c')
        const aviso = await intentarSolapado(page, datos)
        await aviso.getByRole('button', { name: 'Crear igual' }).click()
        await expect(page.getByText('Creamos el turno.')).toBeVisible()
        const { data } = await sc.db
          .from('shifts')
          .select('id')
          .eq('site_id', datos.sede.id)
          .is('deleted_at', null)
        expect(data).toHaveLength(2)
        for (const fila of data ?? []) sc.extraShiftIds.push(fila.id)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
