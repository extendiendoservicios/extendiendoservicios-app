// tests/e2e-supervisiones/mobile-supervisor-without-location.spec.ts — MOB-SUP-013 (P15.6,
// ADR-009, P-067, P-091)
//
// SUP-04 con el permiso de ubicación del navegador SIN conceder (`test.use({ permissions: [] })`):
// el supervisor acepta el consentimiento de la app, pero el navegador deniega el permiso real
// (`PERMISSION_DENIED`, sin diálogo) -- el registro de inicio se completa igual, sin coordenadas
// en la Base (mismo criterio que `tests/e2e-employee-shift/without-geolocation.spec.ts`, copia
// deliberada adaptada a la vía del supervisor).
//
// Datos propios (prefijo `E2E-P156`): un cliente, una sede, un supervisor descartable y un turno
// de hoy, sin empleados (no hace falta ninguno para probar solo el registro de inicio).

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
  assignSupervisionToShift,
  cancelSupervisionFixture,
  createTodayShift,
  fetchSupervisionAttendance,
} from './helpers/shiftFixture.ts'
import { loginAs } from './helpers/login.ts'

const env = readE2eSupervisionesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

// Sin este permiso, Chromium deniega `getCurrentPosition` solo (código `PERMISSION_DENIED`), sin
// mostrar ningún diálogo -- exactamente el caso "permiso de ubicación negado" (P-091).
test.use({ permissions: [] })

test.describe('MOB-SUP-013: SUP-04 sin geolocalización, permiso denegado (P-067, P-091)', () => {
  test('acepta el consentimiento de la app, pero el navegador niega el permiso: el inicio se registra igual, sin coordenadas', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(90_000)

    const admin = getAdminClient()
    const client = await createDisposableClient(admin, 'Cliente-MobSupNoGeo')
    const site = await createDisposableSite(
      admin,
      client.id,
      'Sede-MobSupNoGeo',
    )
    const supervisor = await createDisposableSupervisor(
      admin,
      'mob-nogeo',
      env!.seedPassword,
    )
    const shift = await createTodayShift(admin, client.id, site.id)
    const supervisionId = await assignSupervisionToShift(
      shift.shiftId,
      supervisor.profileId,
    )

    try {
      await loginAs(page, supervisor.email, supervisor.password, /\/sup$/)
      await page.goto(`/sup/supervisiones/${supervisionId}/registro`)

      await expect(page.getByText('Tu ubicación al fichar')).toBeVisible()
      await page.getByRole('button', { name: 'Aceptar y continuar' }).click()
      await expect(
        page.getByText(
          'Hora de referencia de tu celular. La hora que vale y queda registrada es la del servidor.',
        ),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Registrar inicio' }).click()
      await expect(page.getByText(/Supervisión iniciada a las/)).toBeVisible()

      const records = await fetchSupervisionAttendance(admin, supervisionId)
      const checkIn = records.find((r) => r.kind === 'check_in')
      expect(checkIn).toBeDefined()
      expect(checkIn?.latitude).toBeNull()
      expect(checkIn?.longitude).toBeNull()
    } finally {
      // La supervisión quedó `in_progress` (con inicio, sin fin): `cancel_supervision` la cierra
      // igual (acepta `assigned`/`in_progress`, `0029`).
      await cancelSupervisionFixture(supervisionId)
      await deactivateDisposableSupervisor(admin, supervisor.profileId)
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
