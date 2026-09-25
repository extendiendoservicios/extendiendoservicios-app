// tests/e2e-assignments/overlap-and-warning.spec.ts — ASSIGN-015 puntos 2 y 5 (P11.4,
// 08_Fases_y_Backlog.md F11)
//
// Superposición rechazada con su mensaje exacto ("El empleado ya tiene otro turno en ese
// horario.", `0024_rpc_assignments.sql`) y la marca "Se superpone con…" en ADM-08
// (`AssignEmployeeSheet.tsx`); advertencia `NOT_ENABLED_FOR_CLIENT` visible sin bloquear la
// asignación (P-034).
//
// El seed de `App_dev` no carga ninguna fila en `employee_client_permissions`
// (`supabase/seed.sql`; comentario de `0006_employees.sql`: "Lista vacía para un empleado =
// habilitado para todos"), así que ningún empleado del seed dispara esta advertencia por sí
// solo: este spec inserta una fila propia (borrado físico al final -- tabla sin baja lógica,
// solo una habilitación pura, mismo criterio que usa `tests/e2e-clients-sites` para lo que crea
// directo por API) que limita a un empleado a un cliente DISTINTO del cliente fixture de este
// turno, para que la condición de la RPC (`v_has_permissions and not exists ... para este
// cliente`) se cumpla de verdad.

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
import { resolveUserId } from '../permissions/helpers/admin-lookups.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

const env = readE2eAssignmentsEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('ASSIGN-015: superposición rechazada y advertencia sin bloquear', () => {
  test('rechaza la superposición con su mensaje y marca "Se superpone con…"; NOT_ENABLED_FOR_CLIENT se ve pero no bloquea', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(90_000)

    const admin = getAdminClient()
    const clientA = await createDisposableClient(admin, 'Cliente-Overlap-A')
    const siteA = await createDisposableSite(
      admin,
      clientA.id,
      'Sede-Overlap-A',
    )
    const clientB = await createDisposableClient(admin, 'Cliente-Overlap-B')
    const shiftDate = addDaysInBuenosAires(2)

    const firstShift = await createDisposableShift(
      admin,
      clientA.id,
      siteA.id,
      shiftDate,
      {
        startTime: '08:00',
        endTime: '12:00',
        requiredStaff: 1,
      },
    )
    const secondShift = await createDisposableShift(
      admin,
      clientA.id,
      siteA.id,
      shiftDate,
      {
        startTime: '10:00',
        endTime: '14:00',
        requiredStaff: 1,
      },
    )

    // Sofía Ruiz: solo se usa acá y en ningún otro spec de esta suite, para no pisar sus
    // habilitaciones entre corridas paralelas.
    const overlapEmployeeId = await resolveUserId(
      admin,
      SEED_ACCOUNTS.employees[2],
    )
    // Rocío Aguirre: se limita a clientB, así que al ofrecerla en un turno de clientA la RPC
    // marca NOT_ENABLED_FOR_CLIENT (P-034).
    const notEnabledEmployeeId = await resolveUserId(
      admin,
      SEED_ACCOUNTS.employees[5],
    )

    await admin.from('employee_client_permissions').insert({
      employee_id: notEnabledEmployeeId,
      client_id: clientB.id,
    })

    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      await test.step('asigna a Sofía Ruiz al primer turno', async () => {
        await page.goto(`/admin/turnos/${firstShift.id}`)
        await page.getByRole('button', { name: 'Asignar empleado' }).click()
        await page
          .getByTestId('assign-candidate')
          .filter({ hasText: 'Sofía Ruiz' })
          .click()
        await page.getByRole('button', { name: 'Asignar' }).click()
        await expect(page.getByText('Asignamos al empleado.')).toBeVisible()

        const { data: assignments } = await admin
          .from('assignments')
          .select('employee_id')
          .eq('shift_id', firstShift.id)
          .is('removed_at', null)
        expect(assignments ?? []).toEqual([
          expect.objectContaining({ employee_id: overlapEmployeeId }),
        ])
      })

      await test.step('en el segundo turno (horario superpuesto), Sofía aparece marcada "Se superpone con…"', async () => {
        await page.goto(`/admin/turnos/${secondShift.id}`)
        await page.getByRole('button', { name: 'Asignar empleado' }).click()
        const candidate = page
          .getByTestId('assign-candidate')
          .filter({ hasText: 'Sofía Ruiz' })
        await expect(candidate.getByText(/Se superpone con/)).toBeVisible()

        await candidate.click()
        await page.getByRole('button', { name: 'Asignar' }).click()
        await expect(
          page.getByText('El empleado ya tiene otro turno en ese horario.'),
        ).toBeVisible()

        // No bloquea la pantalla: el panel sigue abierto y no se creó ninguna asignación nueva.
        const { data: assignments } = await admin
          .from('assignments')
          .select('id')
          .eq('shift_id', secondShift.id)
          .is('removed_at', null)
        expect(assignments ?? []).toHaveLength(0)
      })

      await test.step('cierra el panel y asigna a Rocío (NOT_ENABLED_FOR_CLIENT): advertencia visible, asignación creada igual', async () => {
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Asignar empleado' }).click()
        const candidate = page
          .getByTestId('assign-candidate')
          .filter({ hasText: 'Rocío Aguirre' })
        await expect(
          candidate.getByText('No habilitado para el cliente'),
        ).toBeVisible()

        await candidate.click()
        await page.getByRole('button', { name: 'Asignar' }).click()
        await expect(
          page.getByText('Asignamos igual, con advertencias: revisalas abajo.'),
        ).toBeVisible()
        await expect(
          page.getByText(
            'Este empleado no figura habilitado para este cliente.',
          ),
        ).toBeVisible()

        const { data: assignments } = await admin
          .from('assignments')
          .select('id, employee_id')
          .eq('shift_id', secondShift.id)
          .is('removed_at', null)
        expect(assignments ?? []).toEqual([
          expect.objectContaining({ employee_id: notEnabledEmployeeId }),
        ])
      })
    } finally {
      // Libera las dos asignaciones ANTES de dar de baja el cliente: sin esto, la corrida
      // siguiente en la misma fecha (regla común: fechas relativas a "hoy", no un mes lejano
      // reservado para esta suite) choca con `ASSIGNMENT_OVERLAP` contra lo que dejó esta
      // corrida (encontrado armando esta suite, ver el reporte del encargo).
      await releaseShiftAssignments(admin, firstShift.id)
      await releaseShiftAssignments(admin, secondShift.id)
      await admin
        .from('employee_client_permissions')
        .delete()
        .eq('employee_id', notEnabledEmployeeId)
        .eq('client_id', clientB.id)
      await cleanupDisposableClient(admin, clientA.id)
      await cleanupDisposableClient(admin, clientB.id)
    }
  })
})
