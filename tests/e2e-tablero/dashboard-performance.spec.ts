// tests/e2e-tablero/dashboard-performance.spec.ts — DASH-009 (P16.2, 08_Fases_y_Backlog.md F16,
// RB-A07)
//
// Criterio de aceptación de F16: "con 24 turnos y 40 asignaciones en el día el tablero carga en
// menos de 1,5 segundos". Se arma un día cargado con datos propios (prefijo `E2E-P162`): 24
// turnos, uno por franja horaria (00:00–00:59 ... 23:00–23:59), 16 con dos asignaciones y 8 con
// una (40 en total), repartidas entre 4 empleados sin superposición.
//
// Medición: desde que se pide la navegación a `/admin` (sesión ya iniciada, caché de la aplicación
// vacía) hasta que se ven los KPIs con los 24 turnos y las 40 filas de "Servicios de hoy". Cinco
// corridas; se informan los tiempos y la cantidad de consultas a la API REST de cada una. El
// tablero cuenta TODO lo de hoy: si App_dev tiene otros turnos de hoy, el día queda más cargado
// que el del criterio (la prueba espera al menos los propios).
//
// Umbral: cada corrida contra el criterio de 1,5 s. Las consultas viajan hasta Supabase en la
// nube desde esta máquina: la latencia de red entra en la medición (se informa tal cual).

import { expect, test, type Request } from '@playwright/test'
import { MISSING_ENV_MESSAGE, readE2eTableroEnv } from './helpers/env.ts'
import {
  NEAR_MIDNIGHT_MESSAGE,
  TableroScenario,
  type DisposableUser,
  isTooCloseToMidnight,
} from './helpers/fixtures.ts'
import {
  kpiSection,
  servicesSection,
  waitForDashboardLoaded,
} from './helpers/dashboard.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

const env = readE2eTableroEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

const SHIFT_COUNT = 24
const ASSIGNMENT_COUNT = 40
const RUNS = 5
const BUDGET_MS = 1500

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

test.describe('DASH-009: rendimiento del tablero con el día cargado', () => {
  test.beforeEach(() => {
    test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)
  })

  test('RB-A07: 24 turnos y 40 asignaciones cargan en menos de 1,5 s, sin consultas por fila', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(240_000)
    const scenario = new TableroScenario()
    try {
      const client = await scenario.createClient('Cliente-Carga')
      const site = await scenario.createSite(client.id, 'Sede-Carga')
      const employees: DisposableUser[] = []
      for (const index of [1, 2, 3, 4]) {
        employees.push(await scenario.createEmployee(`carga${index}`))
      }

      // 24 turnos, uno por hora. Los primeros 16 con dos asignaciones y los otros 8 con una:
      // 40 en total. Dos empleados distintos por turno; ninguno repite franja.
      const shiftIds: string[] = []
      for (let hour = 0; hour < SHIFT_COUNT; hour += 1) {
        shiftIds.push(
          await scenario.createShift(
            client.id,
            site.id,
            `${pad(hour)}:00`,
            `${pad(hour)}:59`,
            hour < 16 ? 2 : 1,
          ),
        )
      }
      const pairs: Array<[string, string]> = []
      shiftIds.forEach((shiftId, hour) => {
        pairs.push([shiftId, employees[hour % 4].profileId])
        if (hour < 16) {
          pairs.push([shiftId, employees[(hour + 1) % 4].profileId])
        }
      })
      expect(pairs).toHaveLength(ASSIGNMENT_COUNT)
      for (let index = 0; index < pairs.length; index += 8) {
        await Promise.all(
          pairs
            .slice(index, index + 8)
            .map(([shiftId, employeeId]) =>
              scenario.assign(shiftId, employeeId),
            ),
        )
      }

      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)
      await waitForDashboardLoaded(page)

      const timings: number[] = []
      const queryCounts: number[] = []
      const apiCounts: number[] = []
      const queryDetail: string[][] = []

      for (let run = 1; run <= RUNS; run += 1) {
        await page.goto('about:blank')
        const apiRequests: string[] = []
        const onRequest = (request: Request) => {
          const url = new URL(request.url())
          if (url.pathname.startsWith('/rest/v1/')) {
            apiRequests.push(`${request.method()} ${url.pathname}`)
          }
        }
        let authRequests = 0
        const onAuth = (request: Request) => {
          if (new URL(request.url()).pathname.startsWith('/auth/v1/')) {
            authRequests += 1
          }
        }
        page.on('request', onRequest)
        page.on('request', onAuth)

        const startedAt = Date.now()
        await page.goto('/admin', { waitUntil: 'commit' })
        // KPIs visibles con los 24 turnos propios (o más, si hay otros de hoy) y las 40 filas.
        await expect(async () => {
          const value = Number(
            await kpiSection(page)
              .getByText('Turnos hoy', { exact: true })
              .locator('xpath=following-sibling::div[1]')
              .innerText(),
          )
          expect(value).toBeGreaterThanOrEqual(SHIFT_COUNT)
        }).toPass({ timeout: 10_000, intervals: [25, 25, 50] })
        await expect(
          servicesSection(page)
            .getByRole('row')
            .filter({ hasText: 'E2E-P162' }),
        ).toHaveCount(ASSIGNMENT_COUNT, { timeout: 10_000 })
        const elapsed = Date.now() - startedAt

        page.off('request', onRequest)
        page.off('request', onAuth)
        timings.push(elapsed)
        queryCounts.push(apiRequests.length)
        apiCounts.push(authRequests)
        queryDetail.push(apiRequests)
      }

      const sorted = [...timings].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      const summary =
        `DASH-009: ${RUNS} corridas, ms = [${timings.join(', ')}], ` +
        `mínimo ${sorted[0]}, mediana ${median}, máximo ${sorted[sorted.length - 1]}; ` +
        `consultas REST por corrida = [${queryCounts.join(', ')}]; ` +
        `llamadas /auth/v1 por corrida = [${apiCounts.join(', ')}]`
      console.log(summary)
      console.log(
        'Consultas de la última corrida:\n  ' +
          queryDetail.at(-1)!.join('\n  '),
      )
      await testInfo.attach('dash-009-tiempos', {
        body: `${summary}\n\n${queryDetail.at(-1)!.join('\n')}`,
        contentType: 'text/plain',
      })

      // Sin N+1: la cantidad de consultas no crece con las 40 filas (4 en el diseño; margen
      // para alguna consulta de apoyo de la sesión, nunca una por fila).
      for (const count of queryCounts) {
        expect(count).toBeLessThan(ASSIGNMENT_COUNT / 2)
      }
      // Criterio de F16.
      for (const elapsed of timings) {
        expect(elapsed).toBeLessThan(BUDGET_MS)
      }
    } finally {
      const notes = await scenario.cleanup()
      if (notes.length > 0) console.log('Limpieza:', notes.join(' | '))
    }
  })
})
