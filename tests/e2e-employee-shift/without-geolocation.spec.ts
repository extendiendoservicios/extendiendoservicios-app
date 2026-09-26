// tests/e2e-employee-shift/without-geolocation.spec.ts — MOB-EMP-017/TEST-010 (P13.4,
// 08_Fases_y_Backlog.md F13, ADR-009, P-067, P-091)
//
// Dos variantes de "sin ubicación", las dos con el permiso de ubicación del navegador SIN
// conceder (`test.use({ permissions: [] })`, todo el archivo):
//
// 1. El empleado ACEPTA el consentimiento de la app, pero el navegador deniega el permiso real:
//    el registro de inicio y de fin se completan igual, sin coordenadas en la Base.
// 2. El empleado elige "Continuar sin ubicación" (rechaza el consentimiento de la app): el
//    registro también se completa sin coordenadas, y la SEGUNDA vez que ficha (un segundo
//    servicio de hoy) no se le vuelve a pedir el consentimiento.

import { expect, test } from '@playwright/test'
import { readE2eEmployeeShiftEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
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
  fetchAttendanceRecords,
} from './helpers/shiftFixture.ts'
import { loginAs } from './helpers/login.ts'

const env = readE2eEmployeeShiftEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

// Sin este permiso, Chromium deniega `getCurrentPosition` solo (código `PERMISSION_DENIED`), sin
// mostrar ningún diálogo -- exactamente el caso "permiso de ubicación negado" (P-091).
test.use({ permissions: [] })

test.describe('MOB-EMP-017: sin geolocalización, permiso denegado (P-067, P-091)', () => {
  test('acepta el consentimiento de la app, pero el navegador niega el permiso: se registra igual, sin coordenadas', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(90_000)

    const admin = getAdminClient()
    const employee = await createDisposableEmployee(
      admin,
      'nogeo-aceptado',
      env!.seedPassword,
    )
    const client = await createDisposableClient(admin, 'Cliente-NoGeo-A')
    const site = await createDisposableSite(admin, client.id, 'Sede-NoGeo-A')
    const shift = await createTodayShift(admin, client.id, site.id)
    const assignmentId = await assignEmployeeToShift(
      shift.shiftId,
      employee.profileId,
    )

    try {
      await loginAs(page, employee.email, employee.password, /\/app$/)
      await page.goto('/app/fichar')
      await page.getByRole('button', { name: 'Continuar' }).click()
      await page.getByRole('button', { name: 'Aceptar y continuar' }).click()
      await expect(page).toHaveURL(/\/app\/fichar\?asignacion=/)

      await page.getByRole('button', { name: 'Registrar inicio' }).click()
      await expect(page).toHaveURL(new RegExp(`/app/en-curso/${assignmentId}$`))

      await page.goto(`/app/en-curso/${assignmentId}/finalizar`)
      await page.getByRole('button', { name: 'Registrar fin' }).click()
      await expect(page).toHaveURL(new RegExp(`/app/resumen/${assignmentId}$`))

      const records = await fetchAttendanceRecords(admin, assignmentId)
      const checkIn = records.find((r) => r.kind === 'check_in')
      const checkOut = records.find((r) => r.kind === 'check_out')
      expect(checkIn?.latitude).toBeNull()
      expect(checkIn?.longitude).toBeNull()
      expect(checkOut?.latitude).toBeNull()
      expect(checkOut?.longitude).toBeNull()
    } finally {
      await deactivateDisposableEmployee(admin, employee.profileId)
      await cleanupDisposableClient(admin, client.id)
    }
  })

  test('rechaza el consentimiento ("Continuar sin ubicación"): se registra igual, y la segunda vez no se vuelve a pedir', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(90_000)

    const admin = getAdminClient()
    const employee = await createDisposableEmployee(
      admin,
      'nogeo-rechazado',
      env!.seedPassword,
    )
    const client = await createDisposableClient(admin, 'Cliente-NoGeo-B')
    const site = await createDisposableSite(admin, client.id, 'Sede-NoGeo-B')
    // Dos turnos de hoy sin superponerse, para probar dos veces el mismo botón "Fichar".
    const shiftA = await createTodayShift(admin, client.id, site.id, -10, 60)
    const shiftB = await createTodayShift(admin, client.id, site.id, 90, 150)
    const assignmentAId = await assignEmployeeToShift(
      shiftA.shiftId,
      employee.profileId,
    )
    const assignmentBId = await assignEmployeeToShift(
      shiftB.shiftId,
      employee.profileId,
    )

    try {
      await loginAs(page, employee.email, employee.password, /\/app$/)

      await test.step('Primera vez: elige el servicio, ve el consentimiento y lo rechaza', async () => {
        await page.goto('/app/fichar')
        // Dos servicios pendientes hoy: hay que elegir primero.
        await expect(
          page.getByText('Tenés más de un servicio hoy. ¿Cuál vas a empezar?'),
        ).toBeVisible()
        await page.getByText(site.name).first().click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(page).toHaveURL(/\/app\/fichar\/consentimiento/)
        await page
          .getByRole('button', { name: 'Continuar sin ubicación' })
          .click()
        await expect(page).toHaveURL(/\/app\/fichar\?asignacion=/)
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
      })

      await test.step('Cierra el primer servicio para dejar libre el fichado del segundo', async () => {
        // Cualquiera de las dos asignaciones pendientes puede haber quedado en curso: se resuelve
        // por la URL a la que redirigió el paso anterior, sin asumir cuál.
        await expect(page).toHaveURL(/\/app\/en-curso\/([^/]+)$/)
        const url = page.url()
        const startedAssignmentId = url.split('/en-curso/')[1]
        await page.goto(`/app/en-curso/${startedAssignmentId}/finalizar`)
        await page.getByRole('button', { name: 'Registrar fin' }).click()
        await expect(page).toHaveURL(/\/app\/resumen\//)

        const records = await fetchAttendanceRecords(admin, startedAssignmentId)
        for (const record of records) {
          expect(record.latitude).toBeNull()
          expect(record.longitude).toBeNull()
        }
      })

      await test.step('Segunda vez: fichar va directo a "Registrar inicio", sin volver a pedir el consentimiento', async () => {
        await page.goto('/app/fichar')
        // Un solo servicio pendiente ahora (el otro ya se cerró): entra directo, sin elegir.
        await expect(
          page.getByText(
            'Hora de referencia de tu celular. La hora que vale y queda registrada es la del servidor.',
          ),
        ).toBeVisible()
        await expect(page).not.toHaveURL(/\/app\/fichar\/consentimiento/)
        await expect(
          page.getByText(
            'Antes de registrar el inicio, te pedimos tu consentimiento de ubicación.',
          ),
        ).toHaveCount(0)
      })
    } finally {
      void assignmentAId
      void assignmentBId
      await deactivateDisposableEmployee(admin, employee.profileId)
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
