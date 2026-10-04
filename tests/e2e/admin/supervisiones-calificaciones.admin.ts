import { expect, test } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import { expectHint } from '../../fixtures/api.ts'
import {
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import {
  readId,
  signedClient,
  storageStatePath,
} from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-016 (P18.1): supervisiones y calificaciones desde la administración (RB-A09, RB-S02).
//   - ADM-13: consulta con filtros por empleado, supervisor, cliente, sede y estado, y la pestaña
//     de calificaciones con puntaje y comentario.
//   - CB-14 (P-083): el supervisor fuera de plazo recibe `RATING_WINDOW_CLOSED`; el administrador
//     con `edit_ratings` edita igual; sin esa capacidad, `FORBIDDEN`.
// El alta, la cancelación y "no realizada" desde ADM-14/ADM-15 ya las recorre
// `tests/e2e-supervisiones/` (SUP-013).
// Cuentas y franjas de este archivo: filtros -> dual (14:00–18:00) y empleado3 (08:00–12:00);
// plazo -> empleado1 (00:00–00:01); supervisores supervisor1 y supervisor2.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

test.describe('supervisiones y calificaciones (ADM-13, ADM-15)', () => {
  test(
    'el listado filtra por empleado, supervisor, cliente y estado, y la pestaña de calificaciones muestra puntaje y comentario',
    cubre('RB-A09', 'RB-S02'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const clienteA = await sc.client('sup-a')
        const sedeA = await sc.site(clienteA.id, 'sup-a')
        const clienteB = await sc.client('sup-b')
        const sedeB = await sc.site(clienteB.id, 'sup-b')
        const turnoA = await sc.shift(
          clienteA.id,
          sedeA.id,
          sc.today,
          FRANJAS.tarde,
        )
        const turnoB = await sc.shift(
          clienteB.id,
          sedeB.id,
          sc.today,
          FRANJAS.manana,
        )
        const asignacionA = await sc.assign(turnoA, 'dual')
        await sc.assign(turnoB, 'empleado3')
        const supervisionA = await sc.assignSupervision(turnoA, 'supervisor1')
        await sc.assignSupervision(turnoB, 'supervisor2')

        // A queda completada con una calificación de 4 y comentario (preparación directa: el plazo
        // de `rate_employee` depende de la hora, y acá se prueba la consulta, no la carga).
        const comentario = 'e2e: muy buen trabajo, sin observaciones'
        await sc.db
          .from('supervisions')
          .update({ status: 'completed' })
          .eq('id', supervisionA)
        const { error } = await sc.db.from('ratings').insert({
          supervision_id: supervisionA,
          assignment_id: asignacionA,
          score: 4,
          comment: comentario,
          created_by: readId('supervisor1'),
        })
        expect(error, error?.message).toBeNull()

        const fila = (cliente: string) =>
          page.getByRole('row').filter({ hasText: cliente })

        await page.goto('/admin/supervisiones')
        await expect(fila(clienteA.name)).toContainText('Completada')
        await expect(fila(clienteA.name)).toContainText('1/1')
        await expect(fila(clienteB.name)).toContainText('Asignada')
        await expect(fila(clienteB.name)).toContainText('0/1')

        await test.step('filtro por supervisor', async () => {
          await page
            .getByRole('combobox', { name: 'Filtrar por supervisor' })
            .click()
          await page
            .getByRole('option', { name: nombreDe('supervisor2') })
            .click()
          await expect(fila(clienteB.name)).toBeVisible()
          await expect(fila(clienteA.name)).toHaveCount(0)
          await page
            .getByRole('combobox', { name: 'Filtrar por supervisor' })
            .click()
          await page
            .getByRole('option', { name: 'Todos los supervisores' })
            .click()
        })

        await test.step('filtro por empleado', async () => {
          await page
            .getByRole('combobox', { name: 'Filtrar por empleado' })
            .click()
          await page.getByRole('option', { name: nombreDe('dual') }).click()
          await expect(fila(clienteA.name)).toBeVisible()
          await expect(fila(clienteB.name)).toHaveCount(0)
          await page
            .getByRole('combobox', { name: 'Filtrar por empleado' })
            .click()
          await page
            .getByRole('option', { name: 'Todos los empleados' })
            .click()
        })

        await test.step('filtro por cliente y por sede', async () => {
          await page
            .getByRole('combobox', { name: 'Filtrar por cliente' })
            .click()
          await page.getByRole('option', { name: clienteB.name }).click()
          await expect(fila(clienteB.name)).toBeVisible()
          await expect(fila(clienteA.name)).toHaveCount(0)
          await page.getByRole('combobox', { name: 'Filtrar por sede' }).click()
          await page.getByRole('option', { name: sedeB.name }).click()
          await expect(fila(clienteB.name)).toBeVisible()
          await page.getByRole('combobox', { name: 'Filtrar por sede' }).click()
          await page.getByRole('option', { name: 'Todas las sedes' }).click()
          await page
            .getByRole('combobox', { name: 'Filtrar por cliente' })
            .click()
          await page.getByRole('option', { name: 'Todos los clientes' }).click()
        })

        await test.step('filtro por estado', async () => {
          await page
            .getByRole('combobox', { name: 'Filtrar por estado' })
            .click()
          await page.getByRole('option', { name: 'Completada' }).click()
          await expect(fila(clienteA.name)).toBeVisible()
          await expect(fila(clienteB.name)).toHaveCount(0)
        })

        await test.step('pestaña Calificaciones: puntaje y comentario de lo cargado', async () => {
          await page.getByRole('tab', { name: 'Calificaciones' }).click()
          const calificacion = page
            .getByRole('row')
            .filter({ hasText: comentario })
          await expect(calificacion).toBeVisible()
          await expect(calificacion).toContainText(nombreDe('dual'))
          await expect(
            calificacion.getByRole('img', { name: '4 de 5 estrellas' }),
          ).toBeVisible()
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test.describe('plazo de edición (CB-14)', () => {
    test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

    test(
      'fuera de plazo el supervisor recibe RATING_WINDOW_CLOSED; el administrador con edit_ratings edita y sin ella recibe FORBIDDEN',
      cubre('RB-A09', 'RB-S04', 'CB-14', 'CB-17', 'P-083'),
      async ({ page }) => {
        const sc = new Scenario()
        try {
          const cliente = await sc.client('plazo')
          const sede = await sc.site(cliente.id, 'plazo')
          // Franja 00:00–00:01: el plazo del supervisor (fin previsto del turno) ya venció a
          // cualquier hora del día, sin depender del reloj de la corrida.
          const turno = await sc.shift(
            cliente.id,
            sede.id,
            sc.today,
            FRANJAS.madrugada,
          )
          const asignacion = await sc.assign(turno, 'empleado1')
          const supervision = await sc.assignSupervision(turno, 'supervisor1')

          const supervisor = await signedClient('supervisor1')
          const inicio = await supervisor.rpc('supervision_check_in', {
            p_supervision_id: supervision,
          })
          expect(inicio.error, inicio.error?.message).toBeNull()
          const { error } = await sc.db.from('ratings').insert({
            supervision_id: supervision,
            assignment_id: asignacion,
            score: 3,
            comment: 'e2e: calificación original',
            created_by: readId('supervisor1'),
          })
          expect(error, error?.message).toBeNull()

          await test.step('el supervisor ya no puede editar su calificación', async () => {
            const intento = await supervisor.rpc('rate_employee', {
              p_supervision_id: supervision,
              p_assignment_id: asignacion,
              p_score: 5,
              p_comment: 'e2e: fuera de plazo',
            })
            expectHint(intento, 'RATING_WINDOW_CLOSED')
          })

          await test.step('un administrador sin edit_ratings recibe FORBIDDEN', async () => {
            const sinCapacidad = await signedClient('adminSinCapacidades')
            expectHint(
              await sinCapacidad.rpc('rate_employee', {
                p_supervision_id: supervision,
                p_assignment_id: asignacion,
                p_score: 5,
                p_comment: 'e2e: sin capacidad',
              }),
              'FORBIDDEN',
            )
          })

          await test.step('el administrador con edit_ratings edita desde ADM-15, sin ventana', async () => {
            await page.goto(`/admin/supervisiones/${supervision}`)
            await expect(
              page.getByRole('img', { name: '3 de 5 estrellas' }),
            ).toBeVisible()
            await page
              .getByRole('button', { name: 'Editar calificación' })
              .click()
            const dialogo = page.getByRole('dialog', {
              name: /^Editar calificación a/,
            })
            await dialogo
              .getByRole('radio', { name: '5 de 5 estrellas' })
              .click()
            await dialogo
              .getByLabel('Comentario (opcional)')
              .fill('e2e: corregida por administración')
            await dialogo.getByRole('button', { name: 'Guardar' }).click()
            await expect(dialogo).toBeHidden()
            await expect(
              page.getByRole('img', { name: '5 de 5 estrellas' }),
            ).toBeVisible()
            await expect(
              page.getByText('e2e: corregida por administración'),
            ).toBeVisible()
          })
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })
})
