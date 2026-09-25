// tests/e2e-assignments/assign-until-full-and-remove.spec.ts — ASSIGN-015 punto 1 (P11.4,
// 08_Fases_y_Backlog.md F11)
//
// Desde el calendario mensual (ADM-03), abre un turno sin cubrir, asigna dos empleados hasta
// completar la dotación (el turno pasa a "Asignado" y aparece en la grilla semanal, ADM-04),
// quita uno con motivo y ve que vuelve a "Programado" (RB-ASSIGN-015, RB-ASSIGN-011,
// RB-ASSIGN-013). Fecha "mañana": el turno se inserta puntual y directo con la clave de servicio
// (sin `generate_shifts`, que sí abarca todo el sistema, `helpers/nearDates.ts`), sobre un
// cliente y una sede propios y descartables -- no hay riesgo de contaminar el mes real de nadie
// más por usar una fecha cercana a hoy.

import { expect, test } from '@playwright/test'
import { readE2eAssignmentsEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  cleanupDisposableClient,
  createDisposableClient,
  createDisposableShift,
  createDisposableSite,
  getAdminClient,
  releaseShiftAssignments,
} from './helpers/adminClient.ts'
import { addDaysInBuenosAires } from './helpers/nearDates.ts'
import { loginAs } from './helpers/login.ts'
import { expectAssignSuccessToast } from './helpers/assignToast.ts'
import { pickSafeEmployee } from './helpers/pickSafeEmployee.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

const env = readE2eAssignmentsEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('ASSIGN-015: asignar hasta completar dotación, ver en la grilla semanal, quitar con motivo', () => {
  test('el turno pasa a Asignado con dos empleados, aparece en la grilla semanal, y vuelve a Programado al quitar uno', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(90_000)

    const admin = getAdminClient()
    const client = await createDisposableClient(admin, 'Cliente-Asignar')
    const site = await createDisposableSite(admin, client.id, 'Sede-Asignar')
    const shiftDate = addDaysInBuenosAires(1)
    const shift = await createDisposableShift(
      admin,
      client.id,
      site.id,
      shiftDate,
      {
        startTime: '08:00',
        endTime: '12:00',
        requiredStaff: 2,
      },
    )
    // Dos candidatos sin conflicto real ese día (ni licencia, ni otra asignación): un nombre
    // fijo (`María Gómez`) podía tener una licencia o un turno real justo esa fecha, hacía
    // fallar la asignación con una advertencia o un error que este spec no está probando
    // (encontrado armando esta suite, ver el reporte del encargo).
    const firstEmployee = await pickSafeEmployee(admin, shiftDate)
    const secondEmployee = await pickSafeEmployee(admin, shiftDate, [
      firstEmployee.id,
    ])

    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      await test.step('ADM-03: abre el turno sin cubrir (0/2) desde el calendario mensual', async () => {
        await page.goto('/admin/planificacion?vista=mes')
        // `App_dev` tiene turnos reales de sobra para "mañana": el chip de este turno puede
        // quedar detrás de "+n más" (`MAX_CHIPS_PER_DAY = 3`, decisión de P11.2 documentada en
        // `docs/features/asignaciones-y-cronograma.md`) -- se entra por el número del día
        // (siempre abre la lista completa, ADM-05), no por el chip directo (frágil: puede no
        // estar entre los tres primeros).
        const dayNumber = Number(shiftDate.slice(8, 10))
        const dayCell = page.locator('div.min-h-28', {
          hasText: String(dayNumber),
        })
        await dayCell.locator('button').first().click()
        await expect(page).toHaveURL(/vista=dia&fecha=/)

        const row = page.locator('tr', { hasText: site.name })
        await row.getByRole('link', { name: 'Ver' }).click()
        await expect(page).toHaveURL(new RegExp(`/admin/turnos/${shift.id}$`))
        await expect(page.getByText('Dotación: 0/2')).toBeVisible()
      })

      await test.step('asigna al primer empleado (queda Programado, dotación incompleta)', async () => {
        await page.getByRole('button', { name: 'Asignar empleado' }).click()
        const firstCandidate = page
          .getByTestId('assign-candidate')
          .filter({ hasText: firstEmployee.fullName })
        await firstCandidate.click()
        await page.getByRole('button', { name: 'Asignar' }).click()
        await expectAssignSuccessToast(page)
        await expect(page.getByText('Dotación: 1/2')).toBeVisible()
      })

      await test.step('asigna al segundo empleado (dotación completa, el turno pasa a Asignado)', async () => {
        await page.getByRole('button', { name: 'Asignar empleado' }).click()
        const secondCandidate = page
          .getByTestId('assign-candidate')
          .filter({ hasText: secondEmployee.fullName })
        await secondCandidate.click()
        await page.getByRole('button', { name: 'Asignar' }).click()
        await expectAssignSuccessToast(page)
        await expect(page.getByText('Dotación: 2/2')).toBeVisible()
        await expect(
          page.getByText('Asignado', { exact: true }).first(),
        ).toBeVisible()
      })

      await test.step('el turno completo aparece en la grilla semanal (ADM-04) para los dos empleados', async () => {
        await page.goto('/admin/planificacion?vista=semana')
        await expect(
          page.getByRole('cell', { name: firstEmployee.fullName }),
        ).toBeVisible()
        await expect(
          page.getByRole('cell', { name: secondEmployee.fullName }),
        ).toBeVisible()
        // La tarjeta de la grilla es un enlace directo al turno, con sede y franja.
        const link = page
          .getByRole('link', { name: new RegExp(`${site.name}`) })
          .first()
        await expect(link).toBeVisible()
      })

      await test.step('quita a un empleado con motivo: la dotación queda incompleta y el turno vuelve a Programado', async () => {
        await page.goto(`/admin/turnos/${shift.id}`)
        await page
          .getByRole('listitem')
          .filter({ hasText: firstEmployee.fullName })
          .getByRole('button', { name: 'Quitar' })
          .click()
        await page
          .getByLabel('Motivo')
          .fill('E2E-P114: prueba de ASSIGN-015 (quitar del turno)')
        await page.getByRole('button', { name: 'Quitar del turno' }).click()
        await expect(
          page.getByText(`Quitamos a ${firstEmployee.fullName} del turno.`),
        ).toBeVisible()
        await expect(page.getByText('Dotación: 1/2')).toBeVisible()
        await expect(
          page.getByText('Programado', { exact: true }).first(),
        ).toBeVisible()
      })

      await test.step('verificación por API: el turno quedó scheduled con una sola asignación vigente', async () => {
        const { data: shiftRow } = await admin
          .from('shifts')
          .select('status')
          .eq('id', shift.id)
          .single()
        expect(shiftRow?.status).toBe('scheduled')

        const { data: assignments } = await admin
          .from('assignments')
          .select('status, removed_at')
          .eq('shift_id', shift.id)
        const active = (assignments ?? []).filter((a) => a.removed_at == null)
        expect(active).toHaveLength(1)
      })
    } finally {
      // Queda una asignación vigente (la de `secondEmployee`, `firstEmployee` ya se quitó desde
      // la interfaz): se libera antes de dar de baja el cliente, para no bloquear con
      // `ASSIGNMENT_OVERLAP` la próxima corrida en la misma fecha.
      await releaseShiftAssignments(admin, shift.id)
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
