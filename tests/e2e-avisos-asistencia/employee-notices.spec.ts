// tests/e2e-avisos-asistencia/employee-notices.spec.ts — ABS-007 (P14.4, 08_Fases_y_Backlog.md
// F14, P-072, P-073)
//
// EMP-12 (`/app/avisar`): el empleado avisa una demora (minutos obligatorios) y una ausencia
// (motivo obligatorio; texto obligatorio si el motivo es "Otro"); se rechaza avisar sobre un
// servicio cuya hora de inicio ya pasó (`TOO_LATE_TO_NOTIFY`, aunque nunca se haya registrado el
// inicio -- P-072/P-073 son "antes de la hora", no "antes del check-in"); Hoy (EMP-03) muestra el
// estado y el texto del aviso vigente (ABS-005); el bloque "Cambios desde tu última visita"
// (P-092, 0028) NO se enciende por el propio aviso del empleado.
//
// Datos propios (prefijo `E2E-P144`): un empleado, un cliente, tres sedes y tres turnos de hoy
// con una asignación cada uno, creados por el arnés -- nada del seed.

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
  argentinaMinutesSinceMidnight,
  argentinaMinutesUntilMidnight,
  assignEmployeeToShift,
  createTodayShift,
  fetchAssignmentStatus,
  fetchAttendanceNotices,
} from './helpers/shiftFixture.ts'
import { loginAs } from './helpers/login.ts'

const env = readE2eAvisosAsistenciaEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

// Este spec necesita dos turnos que "todavía no empezaron" (hasta 70 min en el futuro, mismo
// `shift_date`, sin superponerse entre sí ni con el turno "tarde"): sin margen para eso a último
// momento del día en Argentina (un turno no puede cruzar de fecha, `shifts_time_range_check`), se
// saltea solo y explícito en vez de fallar por una fixture inválida (regla del encargo, "Cuidado
// con la hora").
test.skip(
  argentinaMinutesUntilMidnight() < 90,
  'Faltan menos de 90 min para la medianoche de Argentina: no hay margen para armar los turnos ' +
    '"que todavía no empezaron" sin cruzar de shift_date. Se saltea explícito -- reintentar más ' +
    'tarde o en otra corrida.',
)

// El turno "tarde" usa un offset de -20 min (ya empezó, sin check-in): recién cruzada la
// medianoche todavía no pasaron 20 min desde las 0:00, ese offset se recorta a las 0:00
// (`argentinaTimeWithOffset`) y puede coincidir con el de otro turno de la misma corrida --
// `assign_employee` lo rechazaría por superposición (hallazgo propio, reproducido en vivo).
test.skip(
  argentinaMinutesSinceMidnight() < 25,
  'Todavía no pasaron 25 min desde las 0:00 de Argentina: el turno "tarde" (offset -20) se ' +
    'recortaría a las 0:00 y podría superponerse con otro turno de la fixture. Se saltea ' +
    'explícito -- reintentar en unos minutos.',
)

test.describe('ABS-007: avisar demora y ausencia, rechazo después del inicio (P-072, P-073)', () => {
  test('demora, ausencia, rechazo tardío, texto en Hoy, y el aviso propio no prende "Cambios"', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(120_000)

    const admin = getAdminClient()
    const employee = await createDisposableEmployee(
      admin,
      'avisos',
      env!.seedPassword,
    )
    const client = await createDisposableClient(admin, 'Cliente-Avisos')
    const siteDelay = await createDisposableSite(
      admin,
      client.id,
      'Sede-Demora',
    )
    const siteAbsence = await createDisposableSite(
      admin,
      client.id,
      'Sede-Ausencia',
    )
    const siteLate = await createDisposableSite(admin, client.id, 'Sede-Tarde')

    // Dos turnos que todavía no empezaron (para avisar demora y ausencia) y uno cuya hora de
    // inicio ya pasó, sin check-in (para el rechazo TOO_LATE_TO_NOTIFY) -- offsets siempre
    // relativos a "ahora", recortados a 23:59 por el helper si hiciera falta, y sin superponerse
    // entre sí (mismo empleado en los tres: `assign_employee` rechaza una ventana que se solape
    // con otra asignación vigente de la misma persona, sin importar el cliente/la sede).
    const shiftDelay = await createTodayShift(
      admin,
      client.id,
      siteDelay.id,
      10,
      35,
    )
    const shiftAbsence = await createTodayShift(
      admin,
      client.id,
      siteAbsence.id,
      45,
      70,
    )
    const shiftLate = await createTodayShift(
      admin,
      client.id,
      siteLate.id,
      -20,
      -5,
    )

    const assignmentDelayId = await assignEmployeeToShift(
      shiftDelay.shiftId,
      employee.profileId,
    )
    const assignmentAbsenceId = await assignEmployeeToShift(
      shiftAbsence.shiftId,
      employee.profileId,
    )
    const assignmentLateId = await assignEmployeeToShift(
      shiftLate.shiftId,
      employee.profileId,
    )

    try {
      await loginAs(page, employee.email, employee.password, /\/app$/)

      // Primera visita: `mark_changes_seen` corre solo (empleado recién creado, todo cuenta como
      // "cambiado" la primera vez -- mismo hallazgo que `today-and-changes.spec.ts`).
      await test.step('Primera visita: se marca como vista, línea de base', async () => {
        const marcado = page.waitForResponse((response) =>
          response.url().includes('/rpc/mark_changes_seen'),
        )
        await page.goto('/app')
        await marcado
      })

      await test.step('Avisar una demora de 15 min (valor por defecto del Stepper, minutos siempre presentes)', async () => {
        await page.goto(`/app/avisar?asignacion=${assignmentDelayId}`)
        // Ya viene con el tipo preseleccionado (única asignación notificable elegida por query):
        // el paso "tipo" ofrece demora y ausencia (asignación sin aviso previo), se elige demora.
        await expect(
          page.getByRole('radiogroup', { name: 'Tipo de aviso' }),
        ).toBeVisible()
        await page.getByRole('radio', { name: 'Demora' }).click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(
          page.getByText('Minutos de demora estimados'),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(
          page.getByText('Vas a avisar una demora de 15 min.'),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Confirmar aviso' }).click()
        await expect(
          page.getByText('Avisaste una demora de 15 min.'),
        ).toBeVisible()
      })

      await test.step('Avisar una ausencia con motivo "Otro": texto obligatorio', async () => {
        await page.goto(`/app/avisar?asignacion=${assignmentAbsenceId}`)
        await page.getByRole('radio', { name: 'Ausencia' }).click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await page.getByRole('radio', { name: 'Otro' }).click()
        // Sin texto: "Continuar" no avanza y muestra el error de motivo obligatorio.
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(page.getByText('Contanos el motivo.')).toBeVisible()
        await page
          .getByPlaceholder('Contanos el motivo…')
          .fill('E2E-P144: mudanza imprevista')
        await page.getByRole('button', { name: 'Continuar' }).click()
        await expect(page.getByText('Vas a avisar que no vas.')).toBeVisible()
        await page.getByRole('button', { name: 'Confirmar aviso' }).click()
        // El resultado inmediato (`ResultStep`) es genérico ("Avisaste que no vas."); el texto
        // con el motivo detallado ("Avisaste que no vas: '...'") lo arma `getNoticeMessage` y se
        // ve recién en Hoy (ABS-005, paso siguiente).
        await expect(page.getByText('Avisaste que no vas.')).toBeVisible()
      })

      await test.step('Rechazo tardío: la hora de inicio ya pasó, aunque nunca se registró el check-in', async () => {
        await page.goto(`/app/avisar?asignacion=${assignmentLateId}`)
        await page.getByRole('radio', { name: 'Demora' }).click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await page.getByRole('button', { name: 'Continuar' }).click()
        await page.getByRole('button', { name: 'Confirmar aviso' }).click()
        await expect(
          page.getByText(
            'El aviso tiene que hacerse antes de la hora de inicio.',
          ),
        ).toBeVisible()
      })

      await test.step('Hoy: el texto del aviso vigente se ve en las tarjetas', async () => {
        await page.goto('/app')
        await expect(
          page.getByText('Avisaste una demora de 15 min.'),
        ).toBeVisible()
        await expect(
          page.getByText(/Avisaste que no vas: "E2E-P144: mudanza imprevista"/),
        ).toBeVisible()
      })

      await test.step('El propio aviso no enciende "Cambios desde tu última visita"', async () => {
        // Ya se visitó Hoy dos veces desde los avisos (una por cada `goto('/app')` de los pasos
        // anteriores) sin que ninguna acción ajena tocara las filas: `changed_since_last_seen`
        // (0028) ignora los cambios cuyo `updated_by` es el propio empleado.
        await page.reload()
        await expect(
          page.getByText('Cambios desde tu última visita'),
        ).toHaveCount(0)
      })

      await test.step('En la Base: los avisos quedaron con source employee_app', async () => {
        const noticesDelay = await fetchAttendanceNotices(
          admin,
          assignmentDelayId,
        )
        expect(noticesDelay).toHaveLength(1)
        expect(noticesDelay[0].kind).toBe('delay')
        expect(noticesDelay[0].minutes_late).toBe(15)
        expect(noticesDelay[0].source).toBe('employee_app')

        const noticesAbsence = await fetchAttendanceNotices(
          admin,
          assignmentAbsenceId,
        )
        expect(noticesAbsence).toHaveLength(1)
        expect(noticesAbsence[0].kind).toBe('absence')
        expect(noticesAbsence[0].reason_code).toBe('other')
        expect(noticesAbsence[0].source).toBe('employee_app')

        const noticesLate = await fetchAttendanceNotices(
          admin,
          assignmentLateId,
        )
        expect(noticesLate).toHaveLength(0)
        expect(await fetchAssignmentStatus(admin, assignmentLateId)).toBe(
          'expected',
        )
      })
    } finally {
      await deactivateDisposableEmployee(admin, employee.profileId)
      await cleanupDisposableClient(admin, client.id)
    }
  })
})
