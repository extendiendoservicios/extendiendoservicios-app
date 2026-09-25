// tests/e2e-assignments/month-performance.spec.ts — ASSIGN-016 (P11.4, 08_Fases_y_Backlog.md
// F11: "un mes con 600 turnos tiene que renderizarse en ADM-03 en menos de 1 s después de la
// carga de datos")
//
// Método (documentado también en docs/features/asignaciones-y-cronograma.md, sección
// planificación):
//   1. 600 turnos de fixture, insertados directo con la clave de servicio (sin `generate_shifts`,
//      que además de más lento abarcaría TODO el sistema) en un cliente y una sede propios,
//      repartidos en los 30 días de noviembre de 2191 (20 por día) -- mes reservado para el
//      rendimiento de esta suite, distinto de 2190 (`tests/e2e-shifts-services`) y de 2191-05
//      (usado por otros specs de esta carpeta para fechas cercanas a hoy... en rigor esos usan
//      fechas relativas a hoy, no 2191: este mes queda solo para este spec).
//   2. Login como dueño, navegar a `/admin/planificacion?vista=mes` (un mes cualquiera ya
//      cargado) y recién después saltar a noviembre de 2191 con el `MonthPicker`.
//   3. Medir todo en el reloj del navegador (`performance.now()`), sin pasar por Playwright:
//      inicio = `responseEnd` (Resource Timing) de la última lectura de datos de ese mes; fin =
//      el mes completo pintado (90 chips de la sede de fixture -- 3 por día, el máximo de
//      `MonthCalendar` -- y los 30 "+17 más"), detectado con un `MutationObserver` y seguido de
//      dos `requestAnimationFrame` para contar el cuadro pintado. Mide lo que pide el criterio
//      ("después de la carga de datos"): parseo, agrupado, render de React y pintado.
//   4. Umbral: menos de 1000 ms (criterio de aceptación de F11).
//   5. Limpieza: los 600 turnos se BORRAN FÍSICAMENTE al final (el encargo de P11.4 pide
//      explícitamente "creados y borrados por el propio test"). Son datos sintéticos de
//      rendimiento, no una asignación ni un cliente/sede real con historial que conservar (esos
//      sí quedan con baja lógica, ver `cleanupDisposableClient`) -- y sin este borrado, cada
//      corrida deja 600 turnos más en el mismo mes 2191-11, así que la corrida siguiente mide un
//      mes cada vez más poblado: hallazgo real de esta revisión (ver el reporte del encargo), NO
//      el diseño original de P11.4 (que los dejaba, "no molestan a nada real por estar tan lejos
//      en el tiempo" -- cierto para un cliente/sede cerrados, falso para este spec en particular,
//      que reutiliza el MISMO mes en cada corrida). El `service_role` puede borrar `shifts` sin
//      problema: bypassa RLS (la tabla no tiene política de `delete`, pero eso rige para
//      `authenticated`, no para el rol de la clave de servicio).
//
// Resultado de esta corrida: ver el reporte del encargo (P11.4) y
// docs/features/asignaciones-y-cronograma.md.

import { expect, test } from '@playwright/test'
import type { Database } from '../../src/lib/database.types.ts'
import { readE2eAssignmentsEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  cleanupDisposableClient,
  createDisposableClient,
  createDisposableSite,
  getAdminClient,
} from './helpers/adminClient.ts'
import { pickFarMonth } from './helpers/monthPicker.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

const env = readE2eAssignmentsEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

const PERF_YEAR = 2191
const PERF_MONTH = 11 // noviembre, mes reservado solo para este spec de rendimiento.
const SHIFTS_PER_DAY = 20
const DAYS_IN_MONTH = 30
const TOTAL_SHIFTS = SHIFTS_PER_DAY * DAYS_IN_MONTH // 600

test.describe('ASSIGN-016: un mes con 600 turnos se pinta en menos de 1 s', () => {
  test('el calendario mensual (ADM-03) pinta 600 turnos en menos de 1000 ms después de recibir los datos', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(180_000)

    const admin = getAdminClient()
    const client = await createDisposableClient(admin, 'Cliente-Rendimiento')
    const site = await createDisposableSite(
      admin,
      client.id,
      'Sede-Rendimiento',
    )

    try {
      await test.step('arma 600 turnos de fixture (20 por día, noviembre de 2191)', async () => {
        const rows: Database['public']['Tables']['shifts']['Insert'][] = []
        for (let day = 1; day <= DAYS_IN_MONTH; day++) {
          const shiftDate = `${PERF_YEAR}-${String(PERF_MONTH).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          for (let i = 0; i < SHIFTS_PER_DAY; i++) {
            const startHour = 6 + (i % 12)
            rows.push({
              client_id: client.id,
              site_id: site.id,
              shift_date: shiftDate,
              start_time: `${String(startHour).padStart(2, '0')}:00`,
              end_time: `${String(startHour + 2).padStart(2, '0')}:00`,
              required_staff: 1,
            })
          }
        }
        expect(rows).toHaveLength(TOTAL_SHIFTS)
        // Un solo insert masivo (más rápido y más representativo que 600 llamadas a
        // `create_shift`, que además de asignar checklist uno por uno haría este armado el
        // cuello de botella del propio test, no de la pantalla que se quiere medir).
        const { error } = await admin.from('shifts').insert(rows)
        if (error) {
          throw new Error(
            `No se pudieron insertar los 600 turnos de fixture: ${error.message}`,
          )
        }
      })

      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      await test.step('navega a un mes cualquiera antes de medir (para separar la carga inicial del salto al mes de 600 turnos)', async () => {
        await page.goto('/admin/planificacion?vista=mes')
        await expect(
          page.getByRole('button', { name: 'Elegir mes' }),
        ).toBeVisible()
      })

      const elapsedMs =
        await test.step('salta a noviembre de 2191 y mide el pintado', async () => {
          // Todo se mide en el reloj del propio navegador, sin idas y vueltas con Playwright
          // en el medio (un `evaluate` después de `waitForResponse` llega tarde: el pintado
          // puede haber terminado antes de poner la marca de inicio).
          //
          // Fin: un `MutationObserver` que espera el mes COMPLETO pintado -- 3 chips por día
          // (`MAX_CHIPS_PER_DAY` de `MonthCalendar`) en los 30 días = 90 chips de la sede de
          // fixture, más 30 botones "+17 más" -- y después dos `requestAnimationFrame` para
          // incluir el cuadro pintado, no solo el DOM armado.
          const expectedChips = DAYS_IN_MONTH * 3
          const hiddenLabel = `+${SHIFTS_PER_DAY - 3} más`
          await page.evaluate(
            ({ siteName, expectedChips, hiddenLabel, daysInMonth }) => {
              const w = window as unknown as { __paintedAt?: Promise<number> }
              w.__paintedAt = new Promise<number>((resolve) => {
                const isDone = () =>
                  Array.from(
                    document.querySelectorAll('a[href^="/admin/turnos/"]'),
                  ).filter((a) => a.getAttribute('title')?.includes(siteName))
                    .length === expectedChips &&
                  Array.from(document.querySelectorAll('button')).filter(
                    (b) => b.textContent?.trim() === hiddenLabel,
                  ).length === daysInMonth
                const finish = () =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve(performance.now())),
                  )
                const observer = new MutationObserver(() => {
                  if (isDone()) {
                    observer.disconnect()
                    finish()
                  }
                })
                observer.observe(document.body, {
                  childList: true,
                  subtree: true,
                  characterData: true,
                })
              })
            },
            {
              siteName: site.name,
              expectedChips,
              hiddenLabel,
              daysInMonth: DAYS_IN_MONTH,
            },
          )

          await pickFarMonth(page, 'Elegir mes', PERF_YEAR, PERF_MONTH)

          // Inicio: `responseEnd` (Resource Timing) de la ÚLTIMA respuesta de datos de este mes
          // -- los turnos de `v_shifts_board` y cualquier otra lectura del mismo rango, como
          // feriados o asignaciones --, en el mismo reloj que la marca de fin.
          const monthKey = `${PERF_YEAR}-${String(PERF_MONTH).padStart(2, '0')}`
          return page.evaluate(async (monthKey) => {
            const paintedAt = await (
              window as unknown as { __paintedAt: Promise<number> }
            ).__paintedAt
            const dataEntries = performance
              .getEntriesByType('resource')
              .filter(
                (entry) =>
                  entry.name.includes('/rest/v1/') &&
                  entry.name.includes(monthKey),
              ) as PerformanceResourceTiming[]
            if (dataEntries.length === 0) {
              throw new Error(
                'No se registró ninguna lectura de datos del mes medido.',
              )
            }
            const dataLoadedAt = Math.max(
              ...dataEntries.map((entry) => entry.responseEnd),
            )
            return paintedAt - dataLoadedAt
          }, monthKey)
        })

      console.log(
        `[ASSIGN-016] Calendario mensual con ${TOTAL_SHIFTS} turnos: ${elapsedMs.toFixed(1)} ms desde la última respuesta de datos hasta el mes completo pintado.`,
      )
      expect(elapsedMs).toBeLessThan(1000)
    } finally {
      // Borrado físico de los 600 turnos de fixture ANTES de cerrar el cliente/sede (ver el
      // comentario de arriba): sin esto, el mes 2191-11 acumula 600 turnos más por corrida y deja
      // de representar "un mes con 600 turnos" a partir de la segunda vez que se corre la suite.
      // Sin `throw` acá: lanzar dentro de un `finally` puede tapar el resultado real del test
      // (`no-unsafe-finally`) -- si el borrado falla, queda bien visible en la consola de
      // Playwright igual, y el mes 2191-11 sigue disponible para revisar a mano.
      const { error: deleteError } = await admin
        .from('shifts')
        .delete()
        .eq('client_id', client.id)
      if (deleteError) {
        console.error(
          `[ASSIGN-016] No se pudieron borrar los 600 turnos de fixture en la limpieza: ${deleteError.message}`,
        )
      }
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
