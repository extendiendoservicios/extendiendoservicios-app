// tests/e2e-employee-shift/full-shift-with-geolocation.spec.ts — MOB-EMP-017/TEST-010 (P13.4,
// 08_Fases_y_Backlog.md F13, RB-E01 a RB-E06)
//
// Turno completo de punta a punta, a 390 px, con geolocalización simulada y concedida: consentimiento
// aceptado, registro de inicio, cronómetro, tareas (completar, no realizada con motivo, deshacer),
// observación, finalizar con los dos avisos informativos (obligatoria pendiente y salida
// anticipada) y resumen. También cubre que las tareas queden bloqueadas antes del inicio y después
// del fin (`08_Fases_y_Backlog.md` F13: "tareas bloqueadas antes del inicio"), y verifica en la
// Base que `attendance_records` tenga latitud, longitud y precisión, la asignación termine en
// `finished` y el turno en `completed`.
//
// Datos propios (prefijo `E2E-P134`): un empleado, un cliente, una sede y un turno de hoy con dos
// tareas obligatorias y una asignación, creados por el arnés -- nada del seed.

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
  createTodayShiftTask,
  fetchAssignmentStatus,
  fetchAttendanceRecords,
  fetchShiftStatus,
} from './helpers/shiftFixture.ts'
import { loginAs } from './helpers/login.ts'

const env = readE2eEmployeeShiftEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

// Una posición fija (Plaza de Mayo, CABA) para toda la corrida: alcanza con que exista, la Base
// no la valida contra la sede (P-067, "no se valida contra la sede").
const FIXTURE_GEOLOCATION = { latitude: -34.6083, longitude: -58.3712 }

test.use({
  geolocation: FIXTURE_GEOLOCATION,
  permissions: ['geolocation'],
})

test.describe('MOB-EMP-017: turno completo con geolocalización concedida (RB-E01 a RB-E06)', () => {
  test('consentimiento, inicio, tareas, observación, finalizar y resumen', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(120_000)

    const admin = getAdminClient()
    const employee = await createDisposableEmployee(
      admin,
      'geo',
      env!.seedPassword,
    )
    const client = await createDisposableClient(admin, 'Cliente-Geo')
    const site = await createDisposableSite(admin, client.id, 'Sede-Geo')
    const shift = await createTodayShift(admin, client.id, site.id)
    const taskCompletarId = await createTodayShiftTask(
      admin,
      shift.shiftId,
      0,
      'E2E-P134 tarea a completar',
      true,
    )
    const taskNoRealizadaId = await createTodayShiftTask(
      admin,
      shift.shiftId,
      1,
      'E2E-P134 tarea no realizada',
      true,
    )

    const assignmentId = await assignEmployeeToShift(
      shift.shiftId,
      employee.profileId,
    )

    try {
      await test.step('Antes del inicio: las tareas se ven en solo lectura, con aviso', async () => {
        await loginAs(page, employee.email, employee.password, /\/app$/)
        await page.goto(`/app/en-curso/${assignmentId}/tareas`)
        await expect(
          page.getByText(
            'Todavía no registraste el inicio de este servicio: vas a poder marcar las tareas después de fichar.',
          ),
        ).toBeVisible()
        // Solo lectura: sin botón "No realizada" ni casillero habilitado.
        await expect(
          page.getByRole('button', { name: 'No realizada' }),
        ).toHaveCount(0)
      })

      await test.step('Hoy: la tarjeta destacada muestra el servicio del turno de fixture', async () => {
        await page.goto('/app')
        await expect(page.getByText(client.legalName).first()).toBeVisible()
        // `.first()`: para un empleado recién creado, la primera visita también puede mostrar el
        // nombre de la sede dentro de "Cambios desde tu última visita" (P-092: nunca vio nada
        // antes) además de en la propia tarjeta -- acá solo interesa que el servicio se vea, ese
        // bloque de cambios se prueba en detalle en `today-and-changes.spec.ts`.
        await expect(page.getByText(site.name).first()).toBeVisible()
      })

      await test.step('Fichar: consentimiento de ubicación, aceptar y continuar', async () => {
        await page.goto('/app/fichar')
        await expect(
          page.getByText(
            'Antes de registrar el inicio, te pedimos tu consentimiento de ubicación.',
          ),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(page).toHaveURL(/\/app\/fichar\/consentimiento/)
        await expect(page.getByText('Tu ubicación al fichar')).toBeVisible()
        await page.getByRole('button', { name: 'Aceptar y continuar' }).click()
        await expect(page).toHaveURL(/\/app\/fichar\?asignacion=/)
      })

      await test.step('Registrar inicio: hora de referencia y confirmación', async () => {
        await expect(
          page.getByText(
            'Hora de referencia de tu celular. La hora que vale y queda registrada es la del servidor.',
          ),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(page).toHaveURL(
          new RegExp(`/app/en-curso/${assignmentId}$`),
        )
      })

      await test.step('Servicio en curso: el cronómetro se ve y corre', async () => {
        const chronometer = page.getByText(/^\d{1,2}:\d{2}(:\d{2})?$/)
        await expect(chronometer).toBeVisible()
        const first = await chronometer.textContent()
        // El cronómetro avanza solo (P13.3: `useNow` con 1 s de intervalo) -- sin `sleep` fijo,
        // se espera a que el propio texto cambie (regla común: "sin sleep fijos").
        await expect.poll(async () => chronometer.textContent()).not.toBe(first)
      })

      await test.step('Tareas: completar, no realizada con motivo y deshacer', async () => {
        await page.goto(`/app/en-curso/${assignmentId}/tareas`)
        await expect(page.getByText('E2E-P134 tarea a completar')).toBeVisible()

        await page
          .getByRole('checkbox', {
            name: 'Marcar "E2E-P134 tarea a completar" como completada',
          })
          .click()
        await expect(page.getByText(/Completada \d{2}:\d{2}/)).toBeVisible()

        await page.getByRole('button', { name: 'No realizada' }).click()
        await page
          .getByLabel('Motivo')
          .fill('E2E-P134: no había insumos para esta tarea')
        await page.getByRole('button', { name: 'Marcar no realizada' }).click()
        await expect(
          page.getByText(
            'No realizada · E2E-P134: no había insumos para esta tarea',
          ),
        ).toBeVisible()

        // Deshacer: vuelve a "Pendiente" (el checkbox de una tarea no realizada la deshace).
        await page
          .getByRole('checkbox', {
            name: '"E2E-P134 tarea no realizada" no realizada. Tocá para deshacer.',
          })
          .click()
        await expect(
          page.getByText('E2E-P134 tarea no realizada'),
        ).toBeVisible()
        await expect(page.getByText('Pendiente')).toBeVisible()
      })

      await test.step('Observación: se guarda y queda al volver a entrar', async () => {
        await page.goto(`/app/en-curso/${assignmentId}/observaciones`)
        const nota = 'E2E-P134: quedó todo en orden, sin novedades.'
        await page
          .getByPlaceholder('Escribí tu observación (opcional)…')
          .fill(nota)
        await page.getByRole('button', { name: 'Guardar' }).click()
        await expect(page.getByText('Observación guardada.')).toBeVisible()

        await page.goto(`/app/en-curso/${assignmentId}`)
        await page.goto(`/app/en-curso/${assignmentId}/observaciones`)
        await expect(
          page.getByPlaceholder('Escribí tu observación (opcional)…'),
        ).toHaveValue(nota)
      })

      await test.step('Finalizar: avisos de tarea obligatoria pendiente y salida anticipada', async () => {
        await page.goto(`/app/en-curso/${assignmentId}/finalizar`)
        await expect(
          page.getByText(/Tenés 1 tarea obligatoria pendiente/),
        ).toBeVisible()
        await expect(
          page.getByText(
            'Vas a registrar la salida antes del horario previsto.',
          ),
        ).toBeVisible()
        const finishButton = page.getByRole('button', { name: 'Registrar fin' })
        await expect(finishButton).toBeEnabled()
        await finishButton.click()
        await expect(page).toHaveURL(
          new RegExp(`/app/resumen/${assignmentId}$`),
        )
      })

      await test.step('Resumen: inicio, fin, duración, tareas y observación', async () => {
        await expect(page.getByText('Inicio')).toBeVisible()
        await expect(page.getByText('Fin')).toBeVisible()
        await expect(page.getByText('Duración')).toBeVisible()
        await expect(
          page.getByText('E2E-P134: quedó todo en orden, sin novedades.'),
        ).toBeVisible()
      })

      await test.step('Después del fin: las tareas vuelven a quedar en solo lectura', async () => {
        await page.goto(`/app/en-curso/${assignmentId}/tareas`)
        await expect(
          page.getByText(
            'Ya registraste el fin de este servicio: las tareas quedaron como estaban en ese momento.',
          ),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'No realizada' }),
        ).toHaveCount(0)
      })

      await test.step('En la Base: coordenadas guardadas, asignación finished, turno completed', async () => {
        const records = await fetchAttendanceRecords(admin, assignmentId)
        const checkIn = records.find((r) => r.kind === 'check_in')
        const checkOut = records.find((r) => r.kind === 'check_out')
        expect(checkIn?.latitude).not.toBeNull()
        expect(checkIn?.longitude).not.toBeNull()
        expect(checkIn?.accuracy_m).not.toBeNull()
        expect(checkOut?.latitude).not.toBeNull()
        expect(checkOut?.longitude).not.toBeNull()
        expect(checkOut?.accuracy_m).not.toBeNull()

        expect(await fetchAssignmentStatus(admin, assignmentId)).toBe(
          'finished',
        )
        expect(await fetchShiftStatus(admin, shift.shiftId)).toBe('completed')
      })
    } finally {
      void taskCompletarId
      void taskNoRealizadaId
      await deactivateDisposableEmployee(admin, employee.profileId)
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
