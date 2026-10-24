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

// TEST-016 (P18.1), reescrito en P24.5: supervisiones y calificaciones desde la administración
// (RB-A09, RB-S02; CJ-05, CJ-11, CJ-31).
//   - ADM-13: consulta con filtros por empleado, coordinador, cliente y sede (el filtro por estado
//     de asignación se quitó, CJ-01), varias supervisiones por turno con su duración informativa y
//     la pestaña de calificaciones con puntaje y comentario.
//   - CB-14 (P-083): el supervisor fuera de plazo recibe `RATING_WINDOW_CLOSED`; el administrador
//     con `edit_ratings` edita igual; sin esa capacidad, `FORBIDDEN`.
// La cancelación desde ADM-15 la recorre `tests/e2e-supervisiones/` (SUP-013). Ya no hay alta
// desde administración (el coordinador toma el turno) ni «no realizada» (CJ-01, CJ-26).
// Cuentas y franjas de este archivo: filtros -> dual (14:00–18:00) y empleado3 (08:00–12:00);
// plazo -> empleado1 (00:00–00:01); supervisores supervisor1 y supervisor2.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

// Cada filtro vuelve a pedir la lista al servidor. En una corrida con otras suites a la vez,
// App_dev llegó a demorar once segundos en responder (TEST-029, traza de la corrida 2); con la
// espera por omisión de 10 s eso fallaba sin que la pantalla estuviera mal.
const ESPERA_LISTA = { timeout: 30_000 }

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
        // A: completada por supervisor1 (armada directo: acá se prueba la consulta, no el flujo). B: el
        // coordinador supervisor2 la tiene en curso y supervisor1 ya la completó (CJ-05: dos filas).
        const supervisionA = await sc.supervisionDirecta(
          turnoA,
          'supervisor1',
          {
            estado: 'completada',
          },
        )
        await sc.supervisionDirecta(turnoB, 'supervisor1', {
          estado: 'completada',
        })
        await sc.tomarSupervision(turnoB, 'supervisor2')

        const comentario = 'e2e: muy buen trabajo, sin observaciones'
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
        // CJ-05: el turno B tiene dos supervisiones (una fila por coordinador).
        await expect(fila(clienteB.name)).toHaveCount(2, ESPERA_LISTA)
        await expect(
          fila(clienteB.name).filter({ hasText: nombreDe('supervisor2') }),
        ).toContainText('En curso')
        await expect(
          fila(clienteB.name).filter({ hasText: nombreDe('supervisor1') }),
        ).toContainText('Completada')
        // CJ-14: la duración de la que sigue abierta es informativa y se cuenta hasta ahora.
        await expect(
          fila(clienteB.name).filter({ hasText: nombreDe('supervisor2') }),
        ).toContainText(/\d+ (min|h)/)
        // Ya no se filtra por estado de asignación (CJ-01).
        await expect(
          page.getByRole('combobox', { name: 'Filtrar por estado' }),
        ).toHaveCount(0)

        await test.step('filtro por supervisor', async () => {
          await page
            .getByRole('combobox', { name: 'Filtrar por coordinador' })
            .click()
          await page
            .getByRole('option', { name: nombreDe('supervisor2') })
            .click()
          await expect(fila(clienteB.name)).toHaveCount(1, ESPERA_LISTA)
          await expect(fila(clienteA.name)).toHaveCount(0, ESPERA_LISTA)
          await page
            .getByRole('combobox', { name: 'Filtrar por coordinador' })
            .click()
          await page
            .getByRole('option', { name: 'Todos los coordinadores' })
            .click()
        })

        await test.step('filtro por empleado', async () => {
          await page
            .getByRole('combobox', { name: 'Filtrar por empleado' })
            .click()
          await page.getByRole('option', { name: nombreDe('dual') }).click()
          await expect(fila(clienteA.name)).toBeVisible(ESPERA_LISTA)
          await expect(fila(clienteB.name)).toHaveCount(0, ESPERA_LISTA)
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
          await expect(fila(clienteB.name).first()).toBeVisible(ESPERA_LISTA)
          await expect(fila(clienteA.name)).toHaveCount(0, ESPERA_LISTA)
          await page.getByRole('combobox', { name: 'Filtrar por sede' }).click()
          await page.getByRole('option', { name: sedeB.name }).click()
          await expect(fila(clienteB.name).first()).toBeVisible(ESPERA_LISTA)
          await page.getByRole('combobox', { name: 'Filtrar por sede' }).click()
          await page.getByRole('option', { name: 'Todas las sedes' }).click()
          await page
            .getByRole('combobox', { name: 'Filtrar por cliente' })
            .click()
          await page.getByRole('option', { name: 'Todos los clientes' }).click()
        })

        await test.step('pestaña Calificaciones: puntaje y comentario de lo cargado', async () => {
          await page.getByRole('tab', { name: 'Calificaciones' }).click()
          const calificacion = page
            .getByRole('row')
            .filter({ hasText: comentario })
          await expect(calificacion).toBeVisible(ESPERA_LISTA)
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
          // Tomar un turno ya terminado se puede (CJ-06); con la supervisión abierta la ventana de
          // calificación no corre, y al cerrar (registra el fin) el plazo vence al instante.
          const supervision = await sc.tomarSupervision(turno, 'supervisor1')
          const supervisor = await signedClient('supervisor1')
          const { error } = await sc.db.from('ratings').insert({
            supervision_id: supervision,
            assignment_id: asignacion,
            score: 3,
            comment: 'e2e: calificación original',
            created_by: readId('supervisor1'),
          })
          expect(error, error?.message).toBeNull()
          const cierre = await supervisor.rpc('complete_supervision', {
            p_supervision_id: supervision,
          })
          expect(cierre.error, cierre.error?.message).toBeNull()

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
