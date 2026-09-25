// tests/e2e-assignments/cancelled-shift-keeps-assignments.spec.ts — ASSIGN-015 punto 3 (P11.4,
// 08_Fases_y_Backlog.md F11, criterio de aceptación de F10)
//
// "Un turno cancelado conserva sus asignaciones" -- cierra el pendiente de
// `12_Registro_de_Progreso.md` ("falta la e2e") que `tests/e2e-shifts-services` no pudo probar
// porque `assign_employee` todavía no existía (es de F11): ahora que existe, se arma con
// `assign_employee` real (por interfaz) y se cancela con `cancel_shift` (por interfaz,
// `CancelShiftDialog`, reutilizado en ADM-05).

import { expect, test } from '@playwright/test'
import { readE2eAssignmentsEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  cleanupDisposableClient,
  createDisposableClient,
  createDisposableShift,
  createDisposableSite,
  getAdminClient,
  releaseAssignmentAfterCancelledShift,
} from './helpers/adminClient.ts'
import { addDaysInBuenosAires } from './helpers/nearDates.ts'
import { loginAs } from './helpers/login.ts'
import { expectAssignSuccessToast } from './helpers/assignToast.ts'
import { pickSafeEmployee } from './helpers/pickSafeEmployee.ts'
import { resolveUserId } from '../permissions/helpers/admin-lookups.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

const env = readE2eAssignmentsEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('ASSIGN-015: un turno cancelado conserva sus asignaciones', () => {
  test('cancela un turno con una persona asignada y la asignación sigue vigente, para historial', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(90_000)

    const admin = getAdminClient()
    const client = await createDisposableClient(admin, 'Cliente-Cancelar')
    const site = await createDisposableSite(admin, client.id, 'Sede-Cancelar')
    const shiftDate = addDaysInBuenosAires(3)
    const shift = await createDisposableShift(
      admin,
      client.id,
      site.id,
      shiftDate,
      {
        startTime: '09:00',
        endTime: '13:00',
        requiredStaff: 1,
      },
    )

    let assignmentId = ''
    try {
      // Empleado sin conflicto real en esa franja (ni licencia, ni otra asignación que se
      // superponga con 09:00-13:00): un nombre fijo ("Carlos Medina", "Lucía Torres") puede tener
      // una licencia o un turno real justo esa fecha en el seed real de `App_dev` (mismo hallazgo
      // que documentan `pickSafeEmployee.ts` y `assignToast.ts`), y acá además hace falta el `id`
      // para comprobar `removed_at` por API. Dentro del `try`: si no encuentra candidato libre,
      // el `finally` igual limpia el cliente/sede ya creados (corrección del qa-pruebas que
      // retoma el encargo, ver el reporte).
      const employee = await pickSafeEmployee(admin, shiftDate, {
        startTime: '09:00',
        endTime: '13:00',
      })

      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      await test.step('asigna al empleado elegido al turno (queda Asignado, dotación completa)', async () => {
        await page.goto(`/admin/turnos/${shift.id}`)
        await page.getByRole('button', { name: 'Asignar empleado' }).click()
        await page
          .getByTestId('assign-candidate')
          .filter({ hasText: employee.fullName })
          .click()
        await page.getByRole('button', { name: 'Asignar' }).click()
        await expectAssignSuccessToast(page)
        await expect(page.getByText('Dotación: 1/1')).toBeVisible()

        const { data } = await admin
          .from('assignments')
          .select('id')
          .eq('shift_id', shift.id)
          .is('removed_at', null)
          .single()
        assignmentId = data!.id
      })

      await test.step('cancela el turno con motivo obligatorio, desde la lista del día', async () => {
        await page.goto(`/admin/planificacion?vista=dia&fecha=${shiftDate}`)
        const row = page.locator('tr', { hasText: site.name })
        await row.getByRole('button', { name: 'Cancelar' }).click()
        await page
          .getByLabel('Motivo de la cancelación')
          .fill(
            'E2E-P114: prueba de ASSIGN-015 (turno cancelado conserva asignaciones)',
          )
        await page
          .getByRole('button', { name: 'Cancelar turno' })
          .last()
          .click()
        await expect(page.getByText('Cancelamos el turno.')).toBeVisible()
      })

      await test.step('el turno queda cancelado y la asignación sigue vigente (removed_at nulo)', async () => {
        const { data: shiftRow } = await admin
          .from('shifts')
          .select('status')
          .eq('id', shift.id)
          .single()
        expect(shiftRow?.status).toBe('cancelled')

        const { data: assignmentRow } = await admin
          .from('assignments')
          .select('status, removed_at')
          .eq('id', assignmentId)
          .single()
        expect(assignmentRow?.removed_at).toBeNull()
        expect(assignmentRow?.status).not.toBe('removed')
      })

      await test.step('el detalle del turno sigue mostrando la asignación (para historia)', async () => {
        await page.goto(`/admin/turnos/${shift.id}`)
        // `getByText` a secas choca en "strict mode" con el `span.sr-only` del avatar (mismo
        // nombre, `PersonCell`) y el `<p>` visible: se acota al `<li>` de la asignación, mismo
        // patrón que `assign-until-full-and-remove.spec.ts`.
        await expect(
          page.getByRole('listitem').filter({ hasText: employee.fullName }),
        ).toBeVisible()
        await expect(page.getByText('Dotación: 1/1')).toBeVisible()
      })
    } finally {
      // `remove_assignment` rechaza esto con `SHIFT_CANCELLED` (es justo lo que el test acaba de
      // comprobar): la limpieza libera la asignación directo, ya verificada la conducta real, para
      // no dejar a `employee` con una asignación vigente en `shiftDate` de corrida en corrida
      // (ver el comentario de `releaseAssignmentAfterCancelledShift`).
      if (assignmentId) {
        const ownerProfileId = await resolveUserId(admin, SEED_ACCOUNTS.owner)
        await releaseAssignmentAfterCancelledShift(
          admin,
          assignmentId,
          ownerProfileId,
        )
      }
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
