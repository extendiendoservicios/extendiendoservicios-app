import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import {
  abrirCalendario,
  bloqueDe,
  arrastrar,
  horarioDe,
} from '../fixtures/p30.ts'
import { fechaPasada, minutosTrabajados } from '../fixtures/p31.ts'
import { Scenario, sessionClient } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import {
  cargarJornada,
  finalizarTurno,
} from '../e2e-ajustes-reunion/helpers/historial.ts'

// P31.6 · D-07 (OI-12): el horario (no la fecha) de un turno FINALIZADO se edita, por el dueño y por
// un administrador, desde la ficha del turno, Calendario › Día y el calendario del empleado; las
// horas trabajadas se recalculan con el criterio de siempre (intersección entre el fichaje y la
// franja vigente). Mover de día sigue bloqueado. Caso del plan: franja 10:30–14:30, fichaje de
// 10:02 a 14:56: 240 min; con 10:00–15:00, 294 min. Escritorio 1280 px.
// Cuentas de este archivo: empleado3 y empleado4.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const FRANJA = { start: '10:30', end: '14:30' }

/** Turno finalizado de `quien` con el fichaje del caso: entrada 10:02 y salida 14:56. */
async function turnoFinalizado(
  sc: Scenario,
  slug: string,
  quien: 'empleado3' | 'empleado4',
) {
  const cliente = await sc.client(slug)
  const sede = await sc.site(cliente.id, slug)
  const fecha = fechaPasada()
  const { shiftId, assignmentId } = await cargarJornada(sc, {
    cliente,
    sede,
    fecha,
    franja: FRANJA,
    quien,
    entrada: '10:02',
    salida: '14:56',
  })
  await finalizarTurno(sc, shiftId)
  return { cliente, sede, fecha, shiftId, assignmentId }
}

async function editarHorarioEnElFormulario(
  page: Page,
  desde: string,
  hasta: string,
) {
  await expect(page).toHaveURL(/\/admin\/turnos\/[0-9a-f-]+\/editar$/)
  const aviso = page.getByRole('alert').filter({ hasText: 'ya finalizó' })
  await expect(aviso).toContainText('no la fecha')
  // La fecha no se puede cambiar: no hay selector de fecha, solo el texto.
  await expect(
    page.getByText('la fecha no se puede cambiar', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Fecha del turno' }),
  ).toHaveCount(0)
  await page.getByLabel('Desde').fill(desde)
  await page.getByLabel('Hasta').fill(hasta)
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
}

test.describe('editar el horario de un turno finalizado (D-07)', () => {
  test.describe('dueño', () => {
    test.use({ storageState: storageStatePath('owner') })

    test(
      'ficha del turno › «Editar horario»: 10:30–14:30 pasa a 10:00–15:00 y las horas pasan de 240 a 294 min',
      cubre('RB-A05', 'RB-A06', 'OI-12', 'D-07', 'AJ2-09'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          const { sede, shiftId, assignmentId } = await turnoFinalizado(
            sc,
            'd07-dueno',
            'empleado3',
          )
          expect(await minutosTrabajados(assignmentId)).toBe(240)

          await page.goto(`/admin/turnos/${shiftId}`)
          await expect(page.getByText(sede.name).first()).toBeVisible()
          await page.getByRole('link', { name: 'Editar horario' }).click()
          await editarHorarioEnElFormulario(page, '10:00', '15:00')

          await expect
            .poll(async () => {
              const h = await horarioDe(sc, shiftId)
              return `${h.inicio}-${h.fin}`
            })
            .toBe('10:00-15:00')
          expect(await minutosTrabajados(assignmentId)).toBe(294)
          const { data } = await sc.db
            .from('shifts')
            .select('status, updated_by')
            .eq('id', shiftId)
            .single()
          expect(data?.status).toBe('completed')
          expect(data?.updated_by, 'queda quién lo cambió').not.toBeNull()
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )

    test(
      'calendario del empleado: la hora de fin se edita en el lugar; arrastrar a otro día avisa y no mueve el turno',
      cubre('RB-A04', 'OI-12', 'D-07'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          const { sede, fecha, shiftId, assignmentId } = await turnoFinalizado(
            sc,
            'd07-cal',
            'empleado4',
          )
          await abrirCalendario(page, 'empleado4', fecha)
          const bloque = bloqueDe(page, sede.name)
          await expect(bloque).toBeVisible()

          await test.step('arrastrar a otro día: aviso del servidor y el turno queda donde estaba', async () => {
            const soltar = await arrastrar(
              page,
              bloque,
              page.getByTestId(`dia-${addDays(fecha, 1)}`),
            )
            await soltar()
            await expect(
              page.getByText(
                'Este turno ya terminó: solo se puede cambiar el horario, no la fecha.',
              ),
            ).toBeVisible()
            expect((await horarioDe(sc, shiftId)).fecha).toBe(fecha)
          })

          await test.step('la hora de fin se cambia tocándola: 15:00 y 266 min (10:30 a 14:56)', async () => {
            await bloque
              .getByRole('button', { name: /^Hora de fin del turno de/ })
              .click()
            const campo = bloque.getByRole('textbox', {
              name: /^Hora de fin del turno de/,
            })
            await expect(campo).toBeFocused()
            await campo.fill('1500')
            await page.keyboard.press('Enter')
            await expect
              .poll(async () => (await horarioDe(sc, shiftId)).fin)
              .toBe('15:00')
            expect((await horarioDe(sc, shiftId)).fecha).toBe(fecha)
            expect(await minutosTrabajados(assignmentId)).toBe(266)
          })
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )

    test(
      'por API: cambiar la fecha o pasarlo a «A terminar» da SHIFT_COMPLETED y no toca nada',
      cubre('RB-A05', 'OI-12', 'D-07', 'CB-14'),
      async () => {
        test.setTimeout(120_000)
        const sc = new Scenario()
        try {
          const { fecha, shiftId } = await turnoFinalizado(
            sc,
            'd07-api',
            'empleado3',
          )
          const dueno = await sessionClient('owner')
          const otraFecha = await dueno.rpc('update_shift_time', {
            p_shift_id: shiftId,
            p_start: '10:30',
            p_end: '14:30',
            p_open_ended: false,
            p_date: addDays(fecha, 1),
          })
          expect(otraFecha.error?.hint).toBe('SHIFT_COMPLETED')
          expect(otraFecha.error?.message).toBe(
            'Este turno ya terminó: solo se puede cambiar el horario, no la fecha.',
          )
          const aTerminar = await dueno.rpc('update_shift_time', {
            p_shift_id: shiftId,
            p_start: '10:30',
            p_end: '14:30',
            p_open_ended: true,
          })
          expect(aTerminar.error?.hint).toBe('SHIFT_COMPLETED')
          const h = await horarioDe(sc, shiftId)
          expect([h.fecha, h.inicio, h.fin]).toEqual([fecha, '10:30', '14:30'])
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })

  test.describe('administrador', () => {
    test.use({ storageState: storageStatePath('admin') })

    test(
      'Calendario › Día: el lápiz está en el turno finalizado y el administrador acorta la franja a 10:00–14:30 (268 min)',
      cubre('RB-A05', 'RB-A06', 'OI-12', 'D-07', 'CB-17'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          const { sede, fecha, shiftId, assignmentId } = await turnoFinalizado(
            sc,
            'd07-admin',
            'empleado3',
          )
          await page.goto(`/admin/planificacion?vista=dia&fecha=${fecha}`)
          const fila = page.getByRole('row').filter({ hasText: sede.name })
          await expect(fila).toBeVisible()
          await fila.getByRole('link', { name: 'Editar' }).click()
          await editarHorarioEnElFormulario(page, '10:00', '14:30')

          await expect
            .poll(async () => {
              const h = await horarioDe(sc, shiftId)
              return `${h.inicio}-${h.fin}`
            })
            .toBe('10:00-14:30')
          expect(await minutosTrabajados(assignmentId)).toBe(268)
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })
})
