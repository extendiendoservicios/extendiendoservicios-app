// tests/e2e-shifts-services/generate-shifts-far-month.spec.ts — SHIFT-012/TEST-007 (P10.4,
// 08_Fases_y_Backlog.md F10)
//
// Flujo central de F10: "crear un servicio desde ADM-25 → generar el mes en ADM-09 → ver sus
// turnos en la lista del día (ADM-05)". Corre contra el mes lejano reservado
// (`helpers/farDate.ts`, junio de 2190): `generate_shifts` genera turnos para TODOS los
// servicios `active` con vigencia abierta del sistema, no solo los de esta suite (encargo P10.4,
// "cuidado con generate_shifts: abarca todo el sistema") — por eso las aserciones de este
// archivo son siempre sobre los turnos de los tres servicios de fixture (filtrados por
// `service_id`, nunca sobre los contadores totales que devuelve la RPC.
//
// Tres servicios de fixture, mismo cliente/sede, weekdays=[2] (solo martes, `formatWeekdays`
// según `WEEKDAY_OPTIONS`): junio de 2190 tiene 5 martes (1, 8, 15, 22 y 29); el 15 es el
// feriado de fixture (`FAR_HOLIDAY_DATE`).
//   - `normal`: works_on_holidays=true, active → 5 turnos (incluye el feriado).
//   - `noHolidays`: works_on_holidays=false, active → 4 turnos (todos menos el feriado).
//   - `paused`: works_on_holidays=true, paused → 0 turnos.

import { expect, test } from '@playwright/test'
import { readE2eShiftsServicesEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  cleanupDisposableClient,
  createDisposableClient,
  createDisposableService,
  createDisposableSite,
  ensureFarHoliday,
  getAdminClient,
} from './helpers/adminClient.ts'
import { FAR_HOLIDAY_DATE, FAR_MONTH, FAR_YEAR } from './helpers/farDate.ts'
import { loginAs } from './helpers/login.ts'
import { pickFarMonth } from './helpers/monthPicker.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

const env = readE2eShiftsServicesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('SHIFT-012: servicio → generar → lista del día (mes lejano reservado)', () => {
  test('genera los turnos correctos, respeta feriado y servicio pausado, y no duplica al regenerar', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(180_000) // ~164 clics de año en el MonthPicker + tres generaciones.

    const admin = getAdminClient()
    const client = await createDisposableClient(admin, 'Cliente-Generar')
    const site = await createDisposableSite(admin, client.id, 'Sede-Generar')
    await ensureFarHoliday(admin)

    const normal = await createDisposableService(
      admin,
      client.id,
      site.id,
      'Normal',
      {
        weekdays: [2],
        worksOnHolidays: true,
      },
    )
    const noHolidays = await createDisposableService(
      admin,
      client.id,
      site.id,
      'SinFeriados',
      { weekdays: [2], worksOnHolidays: false },
    )
    const paused = await createDisposableService(
      admin,
      client.id,
      site.id,
      'Pausado',
      {
        weekdays: [2],
        worksOnHolidays: true,
        status: 'paused',
      },
    )
    const serviceIds = [normal.id, noHolidays.id, paused.id]

    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      let firstRunMs = 0
      await test.step('primera generación del mes lejano, con tiempo medido', async () => {
        await page.goto('/admin/turnos/generar')
        await pickFarMonth(page, 'Mes a generar', FAR_YEAR, FAR_MONTH)

        const start = Date.now()
        await page
          .getByRole('button', { name: 'Generar turnos del mes' })
          .click()
        await expect(page.getByText('Generación terminada')).toBeVisible({
          timeout: 60_000,
        })
        firstRunMs = Date.now() - start
        console.log(
          `[SHIFT-012] generación del mes lejano (${FAR_YEAR}-${FAR_MONTH}): ${firstRunMs} ms`,
        )
        expect(firstRunMs).toBeLessThan(10_000)
      })

      await test.step('el servicio "normal" generó los 5 martes, incluido el feriado', async () => {
        const { data, error } = await admin
          .from('shifts')
          .select('shift_date')
          .eq('service_id', normal.id)
          .order('shift_date')
        expect(error).toBeNull()
        const rows = (data ?? []) as { shift_date: string }[]
        expect(rows.map((r) => r.shift_date)).toEqual([
          `${FAR_YEAR}-06-01`,
          `${FAR_YEAR}-06-08`,
          FAR_HOLIDAY_DATE,
          `${FAR_YEAR}-06-22`,
          `${FAR_YEAR}-06-29`,
        ])
      })

      await test.step('el servicio "sin feriados" NO generó el 15 (feriado)', async () => {
        const { data, error } = await admin
          .from('shifts')
          .select('shift_date')
          .eq('service_id', noHolidays.id)
          .order('shift_date')
        expect(error).toBeNull()
        const rows = (data ?? []) as { shift_date: string }[]
        expect(rows.map((r) => r.shift_date)).toEqual([
          `${FAR_YEAR}-06-01`,
          `${FAR_YEAR}-06-08`,
          `${FAR_YEAR}-06-22`,
          `${FAR_YEAR}-06-29`,
        ])
      })

      await test.step('el servicio pausado no generó ningún turno', async () => {
        const { count, error } = await admin
          .from('shifts')
          .select('id', { count: 'exact', head: true })
          .eq('service_id', paused.id)
        expect(error).toBeNull()
        expect(count ?? 0).toBe(0)
      })

      await test.step('ADM-05: el feriado del servicio "normal" aparece en la lista del día', async () => {
        // El feriado de fixture cae en un martes: otros servicios REALES del sistema con
        // vigencia abierta y franja los martes también generan turnos ese mismo día (encargo
        // P10.4, "generate_shifts abarca todo el sistema") -- la fila de esta prueba se ubica
        // por el nombre único del cliente de fixture, no por texto suelto en la página.
        await page.goto(
          `/admin/planificacion?vista=dia&fecha=${FAR_HOLIDAY_DATE}`,
        )
        const row = page
          .locator('tr', { hasText: client.legalName })
          .or(page.locator('[data-slot="card"]', { hasText: client.legalName }))
        await expect(row).toBeVisible()
        await expect(row.getByText(site.name)).toBeVisible()
        await expect(row.getByText('Programado')).toBeVisible()
      })

      await test.step('regenerar el mismo mes no duplica: 0 turnos nuevos para estos tres servicios', async () => {
        await page.goto('/admin/turnos/generar')
        await pickFarMonth(page, 'Mes a generar', FAR_YEAR, FAR_MONTH)
        await page
          .getByRole('button', { name: 'Generar turnos del mes' })
          .click()
        await expect(page.getByText('Generación terminada')).toBeVisible({
          timeout: 60_000,
        })

        const { count: normalCount } = await admin
          .from('shifts')
          .select('id', { count: 'exact', head: true })
          .eq('service_id', normal.id)
        expect(normalCount).toBe(5)
        const { count: noHolidaysCount } = await admin
          .from('shifts')
          .select('id', { count: 'exact', head: true })
          .eq('service_id', noHolidays.id)
        expect(noHolidaysCount).toBe(4)
      })
    } finally {
      await cleanupDisposableClient(admin, client.id, serviceIds)
    }
  })
})
