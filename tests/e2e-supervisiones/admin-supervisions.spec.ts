// tests/e2e-supervisiones/admin-supervisions.spec.ts — SUP-013/TEST-013 (P15.6,
// 08_Fases_y_Backlog.md F15, ADM-13 a ADM-15, 06_API.md §12)
//
// Escritorio de administración, logueado como el dueño del seed (O: `manage_supervisions` y
// `edit_ratings` siempre, P-083, 02_Decisiones.md). Reescrito en P24.5: la administración ya no
// asigna supervisiones (CJ-01) ni las marca «no realizada» (CJ-26); acá se ve el detalle de una
// supervisión en curso (ADM-15), que no hay acción de asignar, y se cancela y se edita una
// calificación (`edit_ratings`). La advertencia SUPERVISES_OWN_SHIFT ahora la devuelve
// `take_supervision` (la cubre `permissions/suite/94-coordinacion`).
//
// Datos propios (prefijo `E2E-P156`): un cliente, una sede, un supervisor y un empleado
// descartables, y cuatro turnos de MAÑANA (ancla fija, sin relación con la hora a la que corra
// la suite -- `tomorrowISODate`/`createTomorrowShift`), uno por escenario.

import { expect, test } from '@playwright/test'
import { readE2eSupervisionesEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  cleanupDisposableClient,
  createDisposableClient,
  createDisposableSite,
  getAdminClient,
} from './helpers/adminClient.ts'
import {
  createDisposableSupervisor,
  deactivateDisposableSupervisor,
} from './helpers/supervisorFixture.ts'
import {
  createDisposableEmployee,
  deactivateDisposableEmployee,
} from './helpers/employeeFixture.ts'
import {
  assignEmployeeToShift,
  cancelSupervisionFixture,
  createTomorrowShift,
  plantSupervisionInProgress,
} from './helpers/shiftFixture.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../fixtures/seed-accounts.ts'

const env = readE2eSupervisionesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('SUP-013: administración de supervisiones (ADM-13 a ADM-15)', () => {
  test('detalle de una supervisión en curso, sin asignar ni «no realizada», cancelar, editar calificación', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(150_000)

    const admin = getAdminClient()
    const client = await createDisposableClient(admin, 'Cliente-Sup')
    const site = await createDisposableSite(admin, client.id, 'Sede-Sup')
    const supervisor = await createDisposableSupervisor(
      admin,
      'adm',
      env!.seedPassword,
    )
    const employee = await createDisposableEmployee(
      admin,
      'adm',
      env!.seedPassword,
    )

    // Escenario 1 (09:00–10:00): el supervisor también queda asignado como empleado del turno.
    const shiftWarning = await createTomorrowShift(
      admin,
      client.id,
      site.id,
      '09:00',
      '10:00',
    )
    const warningAssignmentId = await assignEmployeeToShift(
      shiftWarning.shiftId,
      supervisor.profileId,
    )

    // Escenario 3 (12:00–13:00): "cancelar supervisión".
    const shiftCancel = await createTomorrowShift(
      admin,
      client.id,
      site.id,
      '12:00',
      '13:00',
    )

    // Escenario 4 (13:30–14:30): "editar una calificación" con edit_ratings -- el empleado de
    // fixture queda asignado acá para poder calificarlo.
    const shiftRate = await createTomorrowShift(
      admin,
      client.id,
      site.id,
      '13:30',
      '14:30',
    )
    const rateAssignmentId = await assignEmployeeToShift(
      shiftRate.shiftId,
      employee.profileId,
    )

    let warningSupervisionId: string | null = null
    let cancelSupervisionId: string | null = null
    let rateSupervisionId: string | null = null

    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin/)

      await test.step('ADM-13: no hay «Asignar supervisión» y la ruta vieja no abre la pantalla (CJ-01)', async () => {
        await page.goto('/admin/supervisiones')
        await expect(
          page.getByRole('combobox', { name: 'Filtrar por coordinador' }),
        ).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Asignar supervisión' }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: 'Asignar supervisión' }),
        ).toHaveCount(0)
        await page.goto('/admin/supervisiones/nueva')
        await expect(
          page.getByRole('heading', { name: 'Asignar supervisión' }),
        ).toHaveCount(0)
      })

      await test.step('ADM-15: el detalle muestra cliente, sede, coordinador y estado «En curso», sin «No realizada»', async () => {
        const warningSupervision = await plantSupervisionInProgress(
          admin,
          shiftWarning.shiftId,
          supervisor.profileId,
        )
        warningSupervisionId = warningSupervision
        await page.goto(`/admin/supervisiones/${warningSupervision}`)
        const detailSheet = page.getByRole('dialog', {
          name: 'Detalle de la supervisión',
        })
        await expect(
          detailSheet.getByRole('heading', {
            name: 'Detalle de la supervisión',
          }),
        ).toBeVisible()
        await expect(detailSheet.getByText(client.legalName)).toBeVisible()
        await expect(detailSheet.getByText(site.name)).toBeVisible()
        await expect(
          detailSheet
            .getByText(`${supervisor.firstName} ${supervisor.lastName}`)
            .first(),
        ).toBeVisible()
        await expect(detailSheet.getByText('En curso').first()).toBeVisible()
        await expect(
          detailSheet.getByRole('button', {
            name: 'Marcar como no realizada',
          }),
        ).toHaveCount(0)
      })

      await test.step('ADM-15: cancelar supervisión, con motivo obligatorio', async () => {
        const cancelSupervision = await plantSupervisionInProgress(
          admin,
          shiftCancel.shiftId,
          supervisor.profileId,
        )
        cancelSupervisionId = cancelSupervision
        await page.goto(`/admin/supervisiones/${cancelSupervision}`)
        await page.getByRole('button', { name: 'Cancelar supervisión' }).click()
        await expect(
          page.getByRole('heading', { name: 'Cancelar supervisión' }),
        ).toBeVisible()
        const motivo = 'E2E-P156: se reprogramó el servicio.'
        const cancelDialog = page.getByRole('dialog', {
          name: 'Cancelar supervisión',
        })
        await cancelDialog.getByLabel('Motivo de la cancelación').fill(motivo)
        await cancelDialog
          .getByRole('button', { name: 'Cancelar supervisión' })
          .click()
        await expect(cancelDialog).toBeHidden()
        await expect(page.getByText('Cancelada', { exact: true })).toBeVisible()
        await expect(
          page.getByText(`Motivo de la cancelación: ${motivo}`),
        ).toBeVisible()
      })

      await test.step('ADM-15: editar una calificación con edit_ratings (rate_employee, upsert)', async () => {
        // `rate_employee` exige in_progress/completed (SUPERVISION_NOT_ACTIVE): la supervisión se
        // planta en curso, sin tener que tomar el turno de verdad como el coordinador.
        const rateSupervision = await plantSupervisionInProgress(
          admin,
          shiftRate.shiftId,
          supervisor.profileId,
        )
        rateSupervisionId = rateSupervision
        await page.goto(`/admin/supervisiones/${rateSupervision}`)

        await page.getByRole('button', { name: 'Calificar' }).click()
        const rateDialog = page.getByRole('dialog', { name: /^Calificar a/ })
        await expect(
          rateDialog.getByText(
            `Calificar a ${employee.firstName} ${employee.lastName}`,
          ),
        ).toBeVisible()
        await rateDialog
          .getByRole('radio', { name: '4 de 5 estrellas' })
          .click()
        const primerComentario = 'E2E-P156: buen desempeño, en orden.'
        await rateDialog
          .getByLabel('Comentario (opcional)')
          .fill(primerComentario)
        await rateDialog.getByRole('button', { name: 'Guardar' }).click()
        await expect(rateDialog).toBeHidden()
        // Calificación guardada, de solo lectura (`role="img"`, `StarRating` readOnly): confirma
        // el puntaje sin depender del toast (desaparece solo, puede no estar a tiempo).
        await expect(
          page.getByRole('img', { name: '4 de 5 estrellas' }),
        ).toBeVisible()
        await expect(page.getByText(primerComentario)).toBeVisible()

        // Editar: el mismo botón ahora dice "Editar calificación".
        await page.getByRole('button', { name: 'Editar calificación' }).click()
        const editDialog = page.getByRole('dialog', {
          name: /^Editar calificación a/,
        })
        await expect(
          editDialog.getByText(
            `Editar calificación a ${employee.firstName} ${employee.lastName}`,
          ),
        ).toBeVisible()
        await editDialog
          .getByRole('radio', { name: '5 de 5 estrellas' })
          .click()
        const comentarioEditado = 'E2E-P156: corregido, excelente desempeño.'
        await editDialog
          .getByLabel('Comentario (opcional)')
          .fill(comentarioEditado)
        await editDialog.getByRole('button', { name: 'Guardar' }).click()
        await expect(editDialog).toBeHidden()
        await expect(
          page.getByRole('img', { name: '5 de 5 estrellas' }),
        ).toBeVisible()
        await expect(page.getByText(comentarioEditado)).toBeVisible()
      })
    } finally {
      if (warningSupervisionId) {
        await cancelSupervisionFixture(warningSupervisionId)
      }
      if (rateSupervisionId) {
        await cancelSupervisionFixture(rateSupervisionId)
      }
      void cancelSupervisionId // ya quedó en un estado terminal (cancelled): nada que cancelar.
      void warningAssignmentId
      void rateAssignmentId
      await deactivateDisposableSupervisor(admin, supervisor.profileId)
      await deactivateDisposableEmployee(admin, employee.profileId)
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
