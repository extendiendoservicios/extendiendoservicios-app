// tests/e2e-supervisiones/admin-supervisions.spec.ts — SUP-013/TEST-013 (P15.6,
// 08_Fases_y_Backlog.md F15, ADM-13 a ADM-15, 06_API.md §12)
//
// Escritorio de administración, logueado como el dueño del seed (O: `manage_supervisions` y
// `edit_ratings` siempre, P-083, 02_Decisiones.md): asignar una supervisión (ADM-14) con la
// advertencia SUPERVISES_OWN_SHIFT ("este supervisor también está asignado como empleado en
// este turno", P15.0) y "Ver supervisión"; ver el detalle (ADM-15); marcar como no realizada con
// motivo; cancelar; editar una calificación (`edit_ratings`).
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
  assignSupervisionToShift,
  cancelSupervisionFixture,
  createTomorrowShift,
  forceSupervisionStatus,
  tomorrowISODate,
} from './helpers/shiftFixture.ts'
import { pickFarDate } from './helpers/datePicker.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../fixtures/seed-accounts.ts'

const env = readE2eSupervisionesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('SUP-013: administración de supervisiones (ADM-13 a ADM-15)', () => {
  test('asignar con advertencia, ver supervisión, detalle, no realizada, cancelar, editar calificación', async ({
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

    // Escenario 1 (09:00–10:00): el supervisor también queda asignado como empleado -- dispara
    // SUPERVISES_OWN_SHIFT al asignar la supervisión.
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

    // Escenario 2 (10:30–11:30): "marcar como no realizada".
    const shiftNotDone = await createTomorrowShift(
      admin,
      client.id,
      site.id,
      '10:30',
      '11:30',
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
    let notDoneSupervisionId: string | null = null
    let cancelSupervisionId: string | null = null
    let rateSupervisionId: string | null = null

    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin/)

      await test.step('ADM-14: asignar supervisión con advertencia SUPERVISES_OWN_SHIFT y "Ver supervisión"', async () => {
        await page.goto('/admin/supervisiones')
        // El botón de la lista es `<Button asChild><Link>...` (SupervisionsAdminScreen): rol
        // accesible "link", no "button".
        await page.getByRole('link', { name: 'Asignar supervisión' }).click()
        const assignSheet = page.getByRole('dialog', {
          name: 'Asignar supervisión',
        })
        await expect(
          assignSheet.getByRole('heading', { name: 'Asignar supervisión' }),
        ).toBeVisible()

        const tomorrow = tomorrowISODate()
        const [year, month, day] = tomorrow.split('-').map(Number)
        await pickFarDate(page, 'Fecha del turno', { year, month, day })

        await assignSheet.getByRole('combobox', { name: 'Turno' }).click()
        // Por nombre de cliente/sede de ESTA corrida (no solo el horario): si quedó algún turno
        // de fixture de una corrida anterior sin limpiar en `App_dev`, puede compartir el mismo
        // horario (09:00–10:00) y volver ambiguo el selector.
        await page
          .getByRole('option', {
            name: new RegExp(`${client.legalName}.*${site.name}.*09:00–10:00`),
          })
          .click()
        await assignSheet.getByRole('combobox', { name: 'Supervisor' }).click()
        await page
          .getByRole('option', {
            name: `${supervisor.firstName} ${supervisor.lastName}`,
          })
          .click()
        await assignSheet
          .getByRole('button', { name: 'Asignar supervisión' })
          .click()

        await expect(
          assignSheet.getByText(
            'Este supervisor también está asignado como empleado en este turno.',
          ),
        ).toBeVisible()
        const verButton = assignSheet.getByRole('button', {
          name: 'Ver supervisión',
        })
        await expect(verButton).toBeVisible()
        await verButton.click()
        // "Ver supervisión" entra directo al detalle de la supervisión recién creada.
        await expect(page).toHaveURL(/\/admin\/supervisiones\/[^/]+$/)
        warningSupervisionId = page.url().split('/supervisiones/')[1]
      })

      await test.step('ADM-15: el detalle muestra cliente, sede, supervisor y estado "Asignada"', async () => {
        // El listado (ADM-13) sigue montado detrás del drawer ("background location"): hay que
        // acotar al drawer para no chocar con la misma fila de la tabla.
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
        await expect(detailSheet.getByText('Asignada')).toBeVisible()
      })

      await test.step('ADM-15: marcar como no realizada, con motivo obligatorio', async () => {
        const notDoneSupervision = await assignSupervisionToShift(
          shiftNotDone.shiftId,
          supervisor.profileId,
        )
        notDoneSupervisionId = notDoneSupervision
        await page.goto(`/admin/supervisiones/${notDoneSupervision}`)
        await page
          .getByRole('button', { name: 'Marcar como no realizada' })
          .click()
        await expect(
          page.getByRole('heading', { name: 'Marcar como no realizada' }),
        ).toBeVisible()
        const motivo = 'E2E-P156: el supervisor no pudo asistir a la sede.'
        // Sin nombre, `getByRole('dialog')` también matchea el `Sheet` del detalle (también rol
        // "dialog", el de ADM-15 queda abierto DEBAJO de este diálogo de confirmación).
        const notDoneDialog = page.getByRole('dialog', {
          name: 'Marcar como no realizada',
        })
        await notDoneDialog.getByLabel('Motivo').fill(motivo)
        await notDoneDialog
          .getByRole('button', { name: 'Marcar como no realizada' })
          .click()
        await expect(notDoneDialog).toBeHidden()
        // `exact: true`: sin esto, también matchea el toast "Marcamos la supervisión como no
        // realizada." (desaparece solo, no sirve como aserción estable).
        await expect(
          page.getByText('No realizada', { exact: true }),
        ).toBeVisible()
        await expect(page.getByText(`Motivo: ${motivo}`)).toBeVisible()
      })

      await test.step('ADM-15: cancelar supervisión, con motivo obligatorio', async () => {
        const cancelSupervision = await assignSupervisionToShift(
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
        const rateSupervision = await assignSupervisionToShift(
          shiftRate.shiftId,
          supervisor.profileId,
        )
        rateSupervisionId = rateSupervision
        // `rate_employee` exige in_progress/completed (SUPERVISION_NOT_ACTIVE): se fuerza a mano
        // (clave de servicio), sin tener que fichar de verdad como el supervisor -- mismo
        // criterio que `tests/permissions/admin.permissions.ts`.
        await forceSupervisionStatus(admin, rateSupervision, 'in_progress')
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
      void notDoneSupervisionId // ya quedó en un estado terminal (not_done): nada que cancelar.
      void cancelSupervisionId // ya quedó en un estado terminal (cancelled): nada que cancelar.
      void warningAssignmentId
      void rateAssignmentId
      await deactivateDisposableSupervisor(admin, supervisor.profileId)
      await deactivateDisposableEmployee(admin, employee.profileId)
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
