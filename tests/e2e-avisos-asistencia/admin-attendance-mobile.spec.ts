// tests/e2e-avisos-asistencia/admin-attendance-mobile.spec.ts — ATT-016 (P14.4,
// 08_Fases_y_Backlog.md F14, "Versión móvil de ADM-10 y ADM-11")
//
// Pasada responsive a 390 px de ADM-10 (`AttendanceTodayList`, tabla → tarjetas por debajo de
// 1024 px) y de ADM-11 (`RecordAttendanceSheet`, panel de pantalla completa por debajo de
// 768 px): mismo criterio documentado en `docs/features/asistencia-y-avisos.md` ("Responsive
// (ATT-016)"), verificado acá contra un backend real en vez de solo por inspección visual.
//
// Datos propios (prefijo `E2E-P144`): un empleado, un cliente, una sede y un turno de hoy ya
// empezado, sin check-in.

import { expect, test } from '@playwright/test'
import {
  readE2eAvisosAsistenciaEnv,
  MISSING_ENV_MESSAGE,
} from './helpers/env.ts'
import {
  cleanupDisposableClient,
  createDisposableClient,
  createDisposableSite,
  getAdminClient,
} from './helpers/adminClient.ts'
import {
  createDisposableEmployee,
  deactivateDisposableEmployee,
} from './helpers/employeeFixture.ts'
import {
  assignEmployeeToShift,
  createTodayShift,
  fetchAssignmentStatus,
} from './helpers/shiftFixture.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../fixtures/seed-accounts.ts'

const env = readE2eAvisosAsistenciaEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('ATT-016: ADM-10/ADM-11 a 390 px', () => {
  test('la tabla se ve como tarjetas y el panel de registro ocupa toda la pantalla', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(90_000)

    const admin = getAdminClient()
    const employee = await createDisposableEmployee(
      admin,
      'att016',
      env!.seedPassword,
    )
    const client = await createDisposableClient(admin, 'Cliente-Movil')
    const site = await createDisposableSite(admin, client.id, 'Sede-Movil')
    const shift = await createTodayShift(admin, client.id, site.id, -10, 80)
    const assignmentId = await assignEmployeeToShift(
      shift.shiftId,
      employee.profileId,
    )

    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      await test.step('ADM-10 a 390 px: tarjeta con nombre, franja y acciones (sin tabla)', async () => {
        await page.goto('/admin/asistencia')
        await page
          .getByPlaceholder('Buscar por nombre…')
          .fill(employee.lastName)
        // Sin columnas de tabla visibles (el encabezado "Empleado" de la variante escritorio no
        // se ve por debajo de 1024 px, mismo criterio que `EmployeesPage`/`AttendanceTodayList`).
        await expect(page.getByRole('columnheader')).toHaveCount(0)
        await expect(page.getByText(site.name)).toBeVisible()
        // `toHaveCount(1)` espera a que el filtro por nombre (con retardo) ya se haya aplicado: con
        // `toBeVisible` el botón se leía sobre la lista completa del día y, cuantas más filas
        // dejaban las corridas anteriores de esta suite, más seguro era el error de modo estricto
        // (P19.5d: 15 y luego 18 botones en `App_dev`; no depende de los ajustes de la reunión).
        await expect(
          page.getByRole('button', { name: 'Registrar en nombre' }),
        ).toHaveCount(1)
        // Sin scroll horizontal (RESP-003/RESP-005): el ancho de la página no debe superar el
        // viewport de 390 px.
        const scrollWidth = await page.evaluate(
          () => document.documentElement.scrollWidth,
        )
        expect(scrollWidth).toBeLessThanOrEqual(390)
      })

      await test.step('ADM-11 a 390 px: el panel ocupa toda la pantalla', async () => {
        await page.getByRole('button', { name: 'Registrar en nombre' }).click()
        const sheet = page.getByRole('dialog')
        await expect(sheet).toBeVisible()
        const box = await sheet.boundingBox()
        expect(box?.width).toBeGreaterThanOrEqual(380)
        await page
          .getByLabel('Motivo')
          .fill('E2E-P144: registrado desde el celular')
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(page.getByText('Registramos el inicio.')).toBeVisible()
      })

      await test.step('En la Base: el inicio quedó registrado', async () => {
        expect(await fetchAssignmentStatus(admin, assignmentId)).toBe('present')
      })
    } finally {
      await deactivateDisposableEmployee(admin, employee.profileId)
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
