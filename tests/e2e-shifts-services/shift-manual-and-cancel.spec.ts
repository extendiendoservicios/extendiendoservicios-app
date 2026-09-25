// tests/e2e-shifts-services/shift-manual-and-cancel.spec.ts — SHIFT-012/TEST-007 (P10.4,
// 08_Fases_y_Backlog.md F10)
//
// Alta de turno puntual (ADM-07, con aviso de feriado), cambio de franja de un turno existente,
// y cancelación con motivo obligatorio que conserva las asignaciones (criterio de aceptación de
// F10: "un turno cancelado conserva sus asignaciones para historia"). Fechas del mes lejano
// reservado (`helpers/farDate.ts`): un turno puntual (`create_shift`) no dispara
// `generate_shifts`, así que en rigor no hace falta el mes lejano para esto en particular, pero
// se mantiene por consistencia con el resto de la suite y para poder reutilizar el mismo feriado
// de fixture en el aviso de ADM-07.

import { expect, test } from '@playwright/test'
import { readE2eShiftsServicesEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  cleanupDisposableClient,
  createDisposableClient,
  createDisposableSite,
  ensureFarHoliday,
  getAdminClient,
} from './helpers/adminClient.ts'
import { FAR_HOLIDAY_DATE, FAR_PUNCTUAL_DATE } from './helpers/farDate.ts'
import { loginAs } from './helpers/login.ts'
import { pickFarDate } from './helpers/datePicker.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

const env = readE2eShiftsServicesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('SHIFT-012: turno puntual (ADM-07), cambio de franja y cancelación con motivo', () => {
  test('crea un turno puntual con aviso de feriado, cambia su franja, y cancela otro con motivo obligatorio', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(120_000)

    const admin = getAdminClient()
    const client = await createDisposableClient(admin, 'Cliente-Puntual')
    const site = await createDisposableSite(admin, client.id, 'Sede-Puntual')
    await ensureFarHoliday(admin)

    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      await test.step('ADM-07: turno puntual en feriado, con aviso', async () => {
        await page.goto('/admin/turnos/nuevo')
        await page.getByRole('combobox', { name: 'Cliente' }).click()
        await page.getByRole('option', { name: client.legalName }).click()
        await page.getByRole('combobox', { name: 'Sede' }).click()
        await page.getByRole('option', { name: site.name }).click()
        await pickFarDate(page, 'Fecha del turno', {
          year: 2190,
          month: 6,
          day: 15,
        })
        await expect(
          page.getByText('Esta fecha es feriado. El turno se crea igual'),
        ).toBeVisible()
        await page.getByLabel('Desde').fill('08:00')
        await page.getByLabel('Hasta').fill('12:00')
        await page.getByRole('button', { name: 'Crear turno' }).click()
        await expect(
          page.getByText('Creamos el turno. Ojo: la fecha elegida es feriado.'),
        ).toBeVisible()
        await expect(page).toHaveURL(
          new RegExp(`vista=dia&fecha=${FAR_HOLIDAY_DATE}`),
        )
      })

      let punctualShiftId = ''
      await test.step('ADM-07: segundo turno puntual, sin feriado, para franja y cancelación', async () => {
        await page.goto(`/admin/turnos/nuevo?fecha=${FAR_PUNCTUAL_DATE}`)
        await page.getByRole('combobox', { name: 'Cliente' }).click()
        await page.getByRole('option', { name: client.legalName }).click()
        await page.getByRole('combobox', { name: 'Sede' }).click()
        await page.getByRole('option', { name: site.name }).click()
        await expect(page.getByText('Esta fecha es feriado')).toHaveCount(0)
        await page.getByLabel('Desde').fill('09:00')
        await page.getByLabel('Hasta').fill('13:00')
        await page.getByRole('button', { name: 'Crear turno' }).click()
        await expect(page.getByText('Creamos el turno.')).toBeVisible()

        const { data } = await admin
          .from('shifts')
          .select('id')
          .eq('site_id', site.id)
          .eq('shift_date', FAR_PUNCTUAL_DATE)
          .single()
        punctualShiftId = data!.id as string
      })

      await test.step('cambia la franja del segundo turno', async () => {
        await page.goto(`/admin/turnos/${punctualShiftId}/editar`)
        await page.getByLabel('Desde').fill('10:00')
        await page.getByLabel('Hasta').fill('14:00')
        await page.getByRole('button', { name: 'Guardar cambios' }).click()
        await expect(
          page.getByText('Actualizamos el horario del turno.'),
        ).toBeVisible()

        const { data } = await admin
          .from('shifts')
          .select('start_time, end_time')
          .eq('id', punctualShiftId)
          .single()
        expect(data?.start_time).toBe('10:00:00')
        expect(data?.end_time).toBe('14:00:00')
      })

      // NO se pudo armar la asignación de precondición ni por API directa con la clave de
      // servicio (`permission denied for schema app`: el trigger `app.sync_assignment_window`
      // no es `security definer` y el rol `service_role` no tiene `grant usage on schema app`,
      // solo `authenticated` y `supabase_auth_admin` -- `0003_profiles_roles_capabilities.sql`
      // línea 402) ni por PostgREST autenticado (`assignments` no tiene ninguna política de
      // INSERT en `0012_rls_policies.sql`, solo SELECT y un UPDATE acotado a `notes`: la única
      // vía que documenta `06_API.md` sección 8 es la RPC `assign_employee`, que todavía no
      // existe -- es de F11, `ASSIGN-*`). Reportado al orquestador: el criterio de aceptación de
      // F10 "un turno cancelado conserva sus asignaciones para historia" queda sin poder
      // probarse con una asignación real hasta que exista `assign_employee`; lo que sigue prueba
      // motivo obligatorio y el estado final del turno nada más.

      await test.step('el diálogo de cancelación exige motivo y el botón de cerrar dice "Volver"', async () => {
        await page.goto(
          `/admin/planificacion?vista=dia&fecha=${FAR_PUNCTUAL_DATE}`,
        )
        const row = page.locator('tr', { hasText: site.name })
        await row.getByRole('button', { name: 'Cancelar' }).click()

        const confirmButton = page
          .getByRole('button', { name: 'Cancelar turno' })
          .last()
        await expect(confirmButton).toBeDisabled()

        await expect(page.getByRole('button', { name: 'Volver' })).toBeVisible()

        await page
          .getByLabel('Motivo de la cancelación')
          .fill('E2E-P104: motivo de prueba para SHIFT-012')
        await expect(confirmButton).toBeEnabled()
        await confirmButton.click()
        await expect(page.getByText('Cancelamos el turno.')).toBeVisible()
      })

      await test.step('el turno queda cancelado', async () => {
        const { data: shift } = await admin
          .from('shifts')
          .select('status')
          .eq('id', punctualShiftId)
          .single()
        expect(shift?.status).toBe('cancelled')
      })
    } finally {
      await cleanupDisposableClient(admin, client.id, [])
    }
  })
})
