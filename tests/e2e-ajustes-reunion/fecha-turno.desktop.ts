import { expect, test, type Page } from '@playwright/test'
import { nombreDe } from '../fixtures/accounts.ts'
import { expectHint } from '../fixtures/api.ts'
import { daysFromToday, FRANJAS } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { FRANJAS_MOVIL, fichar } from '../fixtures/movil.ts'
import { Scenario, sessionClient } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import {
  crearLicencia,
  darDeBajaLicencias,
  elegirDia,
  etiquetaDia,
} from './helpers/dia.ts'

// P19.11g · Fecha editable del turno (0059, 0060, 0061 y P19.11d, punto 5 de la reunión del 19 oct).
//   - «Editar turno» (ADM-07): mover a otro día limpia los avisos de ausencia (la asignación vuelve a
//     «Esperado») y lleva al calendario del día nuevo.
//   - Mover a un día de licencia de la persona asignada da el error del servidor (ON_LEAVE).
//   - Una fecha pasada no se ofrece en el selector y el servidor la rechaza (SHIFT_DATE_IN_PAST).
//   - Con fichaje (turno en curso) la fecha no es editable y el servidor responde SHIFT_STARTED.
//   - Feriado en la fecha nueva: diálogo «Mover igual» antes de mover.
// Turnos futuros recortados al día. Cuentas: admin, owner, empleado1 a empleado3.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

/**
 * Pulsa «Guardar cambios». Si el servidor avisa algo antes de mover (feriado o fuera de
 * disponibilidad) sale el diálogo «Mover igual»: se confirma. Termina cuando pasó lo que tenía que
 * pasar (la pantalla ya salió de «Editar» o apareció un aviso de error).
 */
async function guardarConfirmando(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  const mover = page.getByRole('button', { name: 'Mover igual' })
  await expect
    .poll(
      async () =>
        (await mover.isVisible()) ||
        !page.url().includes('/editar') ||
        (await page.locator('[data-sonner-toast][data-type="error"]').count()) >
          0,
      { timeout: 15_000 },
    )
    .toBe(true)
  if (await mover.isVisible()) await mover.click()
}

test.describe('fecha editable del turno (ADM-07)', () => {
  test(
    'mover el turno a otro día limpia la ausencia avisada y lleva al día nuevo',
    cubre('RB-A04', 'RB-A06', 'RB-A08', 'P-051'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const origen = daysFromToday(3)
        const destino = daysFromToday(4)
        const cliente = await sc.client('p1911-mover')
        const sede = await sc.site(cliente.id, 'p1911-mover')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          origen,
          FRANJAS.manana,
        )
        const asignacion = await sc.assign(turno, 'empleado1')
        const admin = await sessionClient('admin')
        const aviso = await admin.rpc('notify_absence', {
          p_assignment_id: asignacion,
          p_reason_code: 'personal',
          p_has_certificate: false,
        })
        expect(aviso.error, aviso.error?.message).toBeNull()

        await page.goto(`/admin/turnos/${turno}`)
        await expect(
          page
            .getByRole('dialog', { name: 'Detalle del turno' })
            .getByText('Ausente · sin certificado'),
        ).toBeVisible()

        await page.goto(`/admin/turnos/${turno}/editar`)
        await expect(
          page.getByText(
            'Al mover el turno de día se limpian los avisos de demora y de ausencia que ya tenía.',
          ),
        ).toBeVisible()
        await elegirDia(page, 'Fecha del turno', destino)
        await expect(page.getByText(/El turno pasa del .* al /)).toBeVisible()
        await guardarConfirmando(page)

        await expect(page).toHaveURL(new RegExp(`fecha=${destino}`))
        const { data: turnoNuevo } = await sc.db
          .from('shifts')
          .select('shift_date')
          .eq('id', turno)
          .single()
        expect(turnoNuevo?.shift_date).toBe(destino)

        await test.step('el aviso quedó anulado y la asignación vuelve a «Esperado»', async () => {
          const { data: avisos } = await sc.db
            .from('attendance_notices')
            .select('voided_at, void_reason')
            .eq('assignment_id', asignacion)
          expect(avisos).toHaveLength(1)
          expect(avisos?.[0]?.void_reason).toBe('SHIFT_DATE_CHANGED')
          expect(avisos?.[0]?.voided_at).not.toBeNull()
          const { data: asg } = await sc.db
            .from('assignments')
            .select('status')
            .eq('id', asignacion)
            .single()
          expect(asg?.status).toBe('expected')
        })

        await test.step('el detalle ya no muestra la ausencia y vuelve a ofrecer «Ausente»', async () => {
          await page.goto(`/admin/turnos/${turno}`)
          const detalle = page.getByRole('dialog', {
            name: 'Detalle del turno',
          })
          await expect(
            detalle.getByRole('button', { name: 'Ausente', exact: true }),
          ).toBeVisible()
          await expect(detalle.getByText(/Ausente · /)).toHaveCount(0)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'mover a un día de licencia de la persona asignada da el error y el turno no se mueve',
    cubre('RB-A04', 'CB-25', 'P-033', 'P-051'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const origen = daysFromToday(3)
        const destino = daysFromToday(5)
        const cliente = await sc.client('p1911-licmover')
        const sede = await sc.site(cliente.id, 'p1911-licmover')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          origen,
          FRANJAS.manana,
        )
        await sc.assign(turno, 'empleado2')
        await crearLicencia('empleado2', destino, destino)

        await page.goto(`/admin/turnos/${turno}/editar`)
        await elegirDia(page, 'Fecha del turno', destino)
        await page.getByRole('button', { name: 'Guardar cambios' }).click()
        const mover = page.getByRole('button', { name: 'Mover igual' })
        const errorLicencia = page
          .locator('[data-sonner-toast]')
          .filter({ hasText: /licencia/i })
        await expect(async () => {
          if (await mover.isVisible()) await mover.click()
          await expect(errorLicencia).toBeVisible({ timeout: 3_000 })
        }).toPass({ timeout: 20_000 })
        await expect(errorLicencia).toContainText(nombreDe('empleado2'))
        await expect(page).toHaveURL(/\/editar/)

        const { data } = await sc.db
          .from('shifts')
          .select('shift_date')
          .eq('id', turno)
          .single()
        expect(data?.shift_date).toBe(origen)
      } finally {
        expect(await darDeBajaLicencias('empleado2'), 'bajas').toEqual([])
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'una fecha pasada no se ofrece en el selector y el servidor la rechaza (SHIFT_DATE_IN_PAST)',
    cubre('RB-A04', 'P-051'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const cliente = await sc.client('p1911-pasado')
        const sede = await sc.site(cliente.id, 'p1911-pasado')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          daysFromToday(3),
          FRANJAS.manana,
        )

        await page.goto(`/admin/turnos/${turno}/editar`)
        await page.getByRole('button', { name: 'Fecha del turno' }).click()
        const abierto = page.locator(
          '[data-slot="popover-content"][data-state="open"]',
        )
        await expect(abierto).toBeVisible()
        // El calendario abre en el mes del turno: se retrocede hasta mostrar «ayer».
        const ayer = daysFromToday(-1)
        const hoy = daysFromToday(0)
        const botonAyer = abierto.getByRole('button', {
          name: new RegExp(`(^|[^0-9])${etiquetaDia(ayer)}`),
        })
        for (let i = 0; i < 3 && (await botonAyer.count()) === 0; i++) {
          await abierto.getByRole('button', { name: /mes anterior/i }).click()
        }
        await expect(botonAyer).toBeDisabled()
        // Hoy sí se puede elegir.
        await expect(
          abierto.getByRole('button', {
            name: new RegExp(`(^|[^0-9])${etiquetaDia(hoy)}`),
          }),
        ).toBeEnabled()
        await page.keyboard.press('Escape')

        await test.step('por API directa, el servidor rechaza la fecha pasada', async () => {
          const owner = await sessionClient('owner')
          expectHint(
            await owner.rpc('update_shift_time', {
              p_shift_id: turno,
              p_start: '08:00',
              p_end: '12:00',
              p_date: ayer,
            }),
            'SHIFT_DATE_IN_PAST',
          )
          const { data } = await sc.db
            .from('shifts')
            .select('shift_date')
            .eq('id', turno)
            .single()
          expect(data?.shift_date).toBe(daysFromToday(3))
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'con fichaje (turno en curso) la fecha no se puede editar y el servidor responde SHIFT_STARTED',
    cubre('RB-A04', 'RB-A06', 'P-051'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const cliente = await sc.client('p1911-fichaje')
        const sede = await sc.site(cliente.id, 'p1911-fichaje')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          FRANJAS_MOVIL.diaCompleto,
        )
        const asignacion = await sc.assign(turno, 'empleado3')
        await fichar('empleado3', asignacion, 'inicio')

        await page.goto(`/admin/turnos/${turno}/editar`)
        await expect(
          page.getByText(
            'El turno ya empezó o terminó: la fecha no se puede cambiar.',
          ),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Fecha del turno' }),
        ).toHaveCount(0)

        const owner = await sessionClient('owner')
        expectHint(
          await owner.rpc('update_shift_time', {
            p_shift_id: turno,
            p_start: '00:00',
            p_end: '23:59',
            p_date: daysFromToday(2),
          }),
          'SHIFT_STARTED',
        )
        const { data } = await sc.db
          .from('shifts')
          .select('shift_date')
          .eq('id', turno)
          .single()
        expect(data?.shift_date).toBe(sc.today)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'mover a un feriado pide confirmación con «Mover igual»; «Volver» no mueve el turno',
    cubre('RB-A04', 'CB-09', 'P-050', 'P-051'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const origen = daysFromToday(3)
        const feriado = daysFromToday(12)
        await sc.holiday(feriado, 'e2e-p1911-feriado')
        const cliente = await sc.client('p1911-feriado')
        const sede = await sc.site(cliente.id, 'p1911-feriado')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          origen,
          FRANJAS.manana,
        )

        await page.goto(`/admin/turnos/${turno}/editar`)
        await elegirDia(page, 'Fecha del turno', feriado)
        await page.getByRole('button', { name: 'Guardar cambios' }).click()
        const confirmacion = page.getByRole('dialog', {
          name: 'Confirmar el cambio de fecha',
        })
        await expect(confirmacion).toBeVisible()
        await expect(confirmacion.getByText(/feriado/i).first()).toBeVisible()
        await confirmacion.getByRole('button', { name: 'Volver' }).click()
        await expect(confirmacion).toHaveCount(0)
        const { data: igual } = await sc.db
          .from('shifts')
          .select('shift_date')
          .eq('id', turno)
          .single()
        expect(igual?.shift_date).toBe(origen)

        await page.getByRole('button', { name: 'Guardar cambios' }).click()
        await page.getByRole('button', { name: 'Mover igual' }).click()
        await expect(page).toHaveURL(new RegExp(`fecha=${feriado}`))
        const { data: movido } = await sc.db
          .from('shifts')
          .select('shift_date')
          .eq('id', turno)
          .single()
        expect(movido?.shift_date).toBe(feriado)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
