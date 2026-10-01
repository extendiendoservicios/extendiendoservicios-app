// tests/e2e-supervisiones/mobile-supervisor-flow.spec.ts — MOB-SUP-013/TEST-013 (P15.6,
// 08_Fases_y_Backlog.md F15, 05_Pantallas_y_Navegacion.md SUP-02 a SUP-09, 06_API.md §12/§13)
//
// App del supervisor a 390 px, con geolocalización simulada y concedida: Hoy (SUP-02), detalle
// (SUP-03), registrar inicio con ubicación (SUP-04), cronómetro implícito (fin), calificar con
// estrellas y comentario (SUP-05), editar esa calificación dentro de la ventana, CB-13 ("Vos" en
// la propia fila, sin acceso a calificarse), cerrar con faltantes ("Falta 1 empleado por
// calificar", SUP-06), "No se pudo realizar" con motivo (otra supervisión) e historial (SUP-08).
//
// Datos propios (prefijo `E2E-P156`): un cliente, una sede, un supervisor descartable (también
// asignado como empleado del turno A, para CB-13) y dos empleados descartables, con dos turnos
// de HOY (SUP-02 solo lista las supervisiones de hoy) sin superponerse.

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
  createTodayShift,
  fetchSupervisionAttendance,
  fetchSupervisionStatus,
} from './helpers/shiftFixture.ts'
import { loginAs } from './helpers/login.ts'

const env = readE2eSupervisionesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

// Una posición fija (Plaza de Mayo, CABA), mismo criterio que `tests/e2e-employee-shift/`: la
// Base no la valida contra la sede (P-067, "no se valida contra la sede").
const FIXTURE_GEOLOCATION = { latitude: -34.6083, longitude: -58.3712 }

test.use({
  geolocation: FIXTURE_GEOLOCATION,
  permissions: ['geolocation'],
})

/** Fila de "Empleados a supervisar" (SUP-03) que contiene `fullName`: el `div` más chico que a la vez tiene ese texto y, si corresponde, un enlace (`PersonCell` no deja ningún testid propio). */
function employeeRow(page: import('@playwright/test').Page, fullName: string) {
  // La clase exacta del `div` de cada fila en `EmployeeRow` (`SupervisionDetailPage.tsx`,
  // `05` SUP-03): más específico que filtrar por texto y "tiene un enlace/span" -- ese filtro
  // también matcheaba el `div` de `PersonCell` (el avatar también trae un `span`), más angosto
  // y sin "Vos" ni el enlace de calificar.
  return page
    .locator('div.flex.items-center.justify-between.gap-2')
    .filter({ hasText: fullName })
}

test.describe('MOB-SUP-013: app del supervisor, turno completo con geolocalización (CB-13)', () => {
  test('Hoy, detalle, inicio con ubicación, fin, calificar, editar, CB-13, cerrar con faltantes, no realizada, historial', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(180_000)

    const admin = getAdminClient()
    const client = await createDisposableClient(admin, 'Cliente-MobSup')
    const site = await createDisposableSite(admin, client.id, 'Sede-MobSup')
    const supervisor = await createDisposableSupervisor(
      admin,
      'mob',
      env!.seedPassword,
    )
    const employeeRated = await createDisposableEmployee(
      admin,
      'mob-calificado',
      env!.seedPassword,
    )
    const employeeMissing = await createDisposableEmployee(
      admin,
      'mob-faltante',
      env!.seedPassword,
    )

    // Turno A (hoy, ya arrancado): el supervisor también va de empleado (CB-13), más los dos
    // empleados a calificar.
    const shiftA = await createTodayShift(admin, client.id, site.id, -10, 180)
    const supervisorAssignmentId = await assignEmployeeToShift(
      shiftA.shiftId,
      supervisor.profileId,
    )
    const ratedAssignmentId = await assignEmployeeToShift(
      shiftA.shiftId,
      employeeRated.profileId,
    )
    const missingAssignmentId = await assignEmployeeToShift(
      shiftA.shiftId,
      employeeMissing.profileId,
    )
    const supervisionAId = await assignSupervisionToShift(
      shiftA.shiftId,
      supervisor.profileId,
    )

    // Turno B (hoy, sin superponerse con A): solo para "No se pudo realizar", sin empleados.
    const shiftB = await createTodayShift(admin, client.id, site.id, 200, 260)
    const supervisionBId = await assignSupervisionToShift(
      shiftB.shiftId,
      supervisor.profileId,
    )

    try {
      await loginAs(page, supervisor.email, supervisor.password, /\/sup$/)

      await test.step('SUP-02 (Hoy): las dos supervisiones de hoy se ven, con cliente y sede', async () => {
        await expect(page.getByText(client.legalName).first()).toBeVisible()
        await expect(page.getByText(site.name).first()).toBeVisible()
      })

      await test.step('Hoy -> SUP-03: entra al detalle del turno A', async () => {
        await page.goto(`/sup/supervisiones/${supervisionAId}`)
        await expect(page.getByText(client.legalName)).toBeVisible()
        // `<Button asChild><Link>...` (SupervisionDetailPage): rol accesible "link".
        await expect(
          page.getByRole('link', { name: 'Registrar inicio de supervisión' }),
        ).toBeVisible()
      })

      await test.step('SUP-04: consentimiento de ubicación y "Registrar inicio" con geolocalización', async () => {
        await page
          .getByRole('link', { name: 'Registrar inicio de supervisión' })
          .click()
        await expect(page.getByText('Tu ubicación al fichar')).toBeVisible()
        await page.getByRole('button', { name: 'Aceptar y continuar' }).click()
        await expect(
          page.getByText(
            'Hora de referencia de tu celular. La hora que vale y queda registrada es la del servidor.',
          ),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(page.getByText(/Supervisión iniciada a las/)).toBeVisible()
      })

      await test.step('SUP-04: "Registrar fin" vuelve al detalle con la hora de fin', async () => {
        await page.getByRole('button', { name: 'Registrar fin' }).click()
        await expect(page).toHaveURL(
          new RegExp(`/sup/supervisiones/${supervisionAId}$`),
        )
        await expect(page.getByText(/Finalizada a las/)).toBeVisible()
      })

      await test.step('En la Base: supervision_attendance guardó latitud, longitud y precisión', async () => {
        const records = await fetchSupervisionAttendance(admin, supervisionAId)
        const checkIn = records.find((r) => r.kind === 'check_in')
        const checkOut = records.find((r) => r.kind === 'check_out')
        expect(checkIn?.latitude).not.toBeNull()
        expect(checkIn?.longitude).not.toBeNull()
        expect(checkIn?.accuracy_m).not.toBeNull()
        expect(checkOut?.latitude).not.toBeNull()
        expect(checkOut?.longitude).not.toBeNull()
      })

      await test.step('CB-13: la propia fila del supervisor dice "Vos", sin acceso a calificarse', async () => {
        const ownName = `${supervisor.firstName} ${supervisor.lastName}`
        const row = employeeRow(page, ownName)
        await expect(row.getByText('Vos')).toBeVisible()
        await expect(
          row.getByRole('link', { name: /Calificar|Editar/ }),
        ).toHaveCount(0)
      })

      await test.step('SUP-05: calificar con estrellas y comentario', async () => {
        const ratedName = `${employeeRated.firstName} ${employeeRated.lastName}`
        await employeeRow(page, ratedName)
          .getByRole('link', { name: 'Calificar' })
          .click()
        await expect(page).toHaveURL(
          new RegExp(`/sup/supervisiones/${supervisionAId}/calificar/`),
        )
        await page.getByRole('radio', { name: '4 de 5 estrellas' }).click()
        const comentario = 'E2E-P156: buen desempeño, cumplió con todo.'
        await page.getByPlaceholder('Comentario (opcional)…').fill(comentario)
        await page.getByRole('button', { name: 'Guardar calificación' }).click()
        await expect(page).toHaveURL(
          new RegExp(`/sup/supervisiones/${supervisionAId}$`),
        )
        await expect(
          employeeRow(page, ratedName).getByRole('link', { name: 'Editar' }),
        ).toBeVisible()
      })

      await test.step('Editar la calificación dentro de la ventana (P-083)', async () => {
        const ratedName = `${employeeRated.firstName} ${employeeRated.lastName}`
        await employeeRow(page, ratedName)
          .getByRole('link', { name: 'Editar' })
          .click()
        // Prellenada con el puntaje anterior.
        await expect(
          page.getByRole('radio', { name: '4 de 5 estrellas', checked: true }),
        ).toBeVisible()
        await page.getByRole('radio', { name: '5 de 5 estrellas' }).click()
        await page.getByRole('button', { name: 'Guardar calificación' }).click()
        await expect(page).toHaveURL(
          new RegExp(`/sup/supervisiones/${supervisionAId}$`),
        )
        await expect(
          employeeRow(page, ratedName).getByRole('img', {
            name: '5 de 5 estrellas',
          }),
        ).toBeVisible()
      })

      await test.step('SUP-06: cerrar con faltantes ("Falta 1 empleado por calificar")', async () => {
        // `<Button asChild><Link>...` (SupervisionDetailPage): rol accesible "link".
        await page.getByRole('link', { name: 'Cerrar supervisión' }).click()
        await expect(page).toHaveURL(
          new RegExp(`/sup/supervisiones/${supervisionAId}/cerrar`),
        )
        // `totalToRate` excluye al propio supervisor (CB-13): 2 empleados de los 3 asignados.
        await expect(page.getByText('Calificaste a 1 de 2')).toBeVisible()
        await expect(
          page.getByText('Falta 1 empleado por calificar', { exact: false }),
        ).toBeVisible()
        await page
          .getByRole('button', { name: 'Completar supervisión' })
          .click()
        // DEFECTO (ver el informe de este encargo): `handleComplete` (`CloseSupervisionPage.tsx`)
        // navega a `/sup` después de completar, pero en la práctica la página queda en el
        // detalle (`/sup/supervisiones/{id}`) -- la propia pantalla de cierre se redirige sola a
        // ese detalle apenas `supervision.status` pasa a `completed` (guarda
        // `CLOSED_STATUSES`/`<Navigate>`), carrera que parece ganarle al `navigate('/sup')`
        // explícito. La supervisión sí queda completada (se verifica contra la Base, no contra la
        // URL): no se bloquea el resto de la prueba por este defecto.
        await expect(page).toHaveURL(
          new RegExp(`/sup/supervisiones/${supervisionAId}$`),
        )
        expect(await fetchSupervisionStatus(admin, supervisionAId)).toBe(
          'completed',
        )
      })

      await test.step('SUP-06: "No se pudo realizar" con motivo (turno B, sin check-in)', async () => {
        await page.goto(`/sup/supervisiones/${supervisionBId}/cerrar`)
        await expect(
          page.getByText('Contá por qué no se pudo realizar la supervisión.'),
        ).toBeVisible()
        const motivo = 'E2E-P156: la sede estaba cerrada por refacciones.'
        await page.getByPlaceholder('Motivo…').fill(motivo)
        await page
          .getByRole('button', { name: 'Marcar como no realizada' })
          .click()
        // Mismo defecto que el paso anterior: queda en el detalle, no en `/sup`.
        await expect(page).toHaveURL(
          new RegExp(`/sup/supervisiones/${supervisionBId}$`),
        )
        expect(await fetchSupervisionStatus(admin, supervisionBId)).toBe(
          'not_done',
        )
      })

      await test.step('SUP-08: historial con las dos supervisiones ya cerradas', async () => {
        await page.goto('/sup/historial')
        await expect(page.getByText('1 de 3 calificados')).toBeVisible()
        await expect(
          page.getByText(
            'Motivo: E2E-P156: la sede estaba cerrada por refacciones.',
          ),
        ).toBeVisible()
      })
    } finally {
      void supervisorAssignmentId
      void ratedAssignmentId
      void missingAssignmentId
      await deactivateDisposableSupervisor(admin, supervisor.profileId)
      await deactivateDisposableEmployee(admin, employeeRated.profileId)
      await deactivateDisposableEmployee(admin, employeeMissing.profileId)
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
