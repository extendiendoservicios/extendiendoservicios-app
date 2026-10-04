// tests/e2e-avisos-asistencia/admin-attendance.spec.ts — ATT-015 (P14.4, 08_Fases_y_Backlog.md
// F14, P-069, P-073, P-075)
//
// Administración (dueño, `manage_attendance` siempre): registra el inicio en nombre del empleado
// "por teléfono" con motivo y hora editada (ADM-11, `admin_record_attendance`); una hora futura
// se rechaza con el mensaje debajo del campo (cliente, antes de llegar al servidor); cierra una
// asignación sin fin (`close_assignment`); ADM-10 muestra "Sin registro" para una asignación
// pasada la hora de inicio sin check-in; la línea de tiempo de ADM-06 muestra el registro y el
// aviso con quién los cargó ("lo cargó <nombre>"); ADM-12 (pestaña de ADM-17) muestra el
// historial.
//
// Datos propios (prefijo `E2E-P144`): un empleado, un cliente, tres sedes y tres turnos de hoy
// con una asignación cada uno.

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
  resolveOwnerName,
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
  fetchAttendanceRecords,
} from './helpers/shiftFixture.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../fixtures/seed-accounts.ts'

const env = readE2eAvisosAsistenciaEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

// Mismo motivo que `employee-notices.spec.ts`: el campo "Hora" de ADM-11 necesita margen entre
// "ahora" y la medianoche de Argentina para poder probar, a la vez, el rechazo de una hora futura
// y una hora editada válida (regla del encargo, "Cuidado con la hora").
test.skip(
  argentinaMinutesUntilMidnight() < 45,
  'Faltan menos de 45 min para la medianoche de Argentina: margen insuficiente para el campo ' +
    '"Hora" de ADM-11 en este spec. Se saltea explícito -- reintentar más tarde.',
)

// El turno "check-in por teléfono" usa un offset de -35 min: recién cruzada la medianoche
// todavía no pasaron 35 min desde las 0:00, ese offset se recorta a las 0:00
// (`argentinaTimeWithOffset`) y puede coincidir con el de otro turno de la fixture --
// `assign_employee` lo rechazaría por superposición (mismo hallazgo que `employee-notices.spec.ts`,
// reproducido en vivo contra `App_dev` a las 00:0x de Argentina).
test.skip(
  argentinaMinutesSinceMidnight() < 40,
  'Todavía no pasaron 40 min desde las 0:00 de Argentina: el turno de "inicio por teléfono" ' +
    '(offset -35) se recortaría a las 0:00 y podría superponerse con otro turno de la fixture. ' +
    'Se saltea explícito -- reintentar en unos minutos.',
)

test.describe('ATT-015: registrar en nombre del empleado, cierre manual, "Sin registro", timeline y historial', () => {
  test('inicio por teléfono, hora futura rechazada, cierre manual, ADM-10/ADM-06/ADM-12', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(150_000)

    const admin = getAdminClient()
    const owner = await resolveOwnerName(admin, env!.seedPassword)
    const ownerFullName = `${owner.firstName} ${owner.lastName}`

    const employee = await createDisposableEmployee(
      admin,
      'att015',
      env!.seedPassword,
    )
    const client = await createDisposableClient(admin, 'Cliente-Asistencia')
    const siteCheckIn = await createDisposableSite(
      admin,
      client.id,
      'Sede-Inicio-Telefono',
    )
    const siteNoRecord = await createDisposableSite(
      admin,
      client.id,
      'Sede-Sin-Registro',
    )
    const siteAbsence = await createDisposableSite(
      admin,
      client.id,
      'Sede-Ausencia-Admin',
    )

    // Los tres turnos ya empezaron (offset negativo): para "inicio por teléfono" y "sin
    // registro" hace falta que la hora de inicio ya haya pasado; para el aviso de ausencia en
    // nombre, P-073 permite avisarla antes O después del inicio efectivo mientras no haya
    // check-in -- no hace falta que sea futuro, a diferencia de `notify_delay`. Sin superponerse
    // entre sí (mismo empleado en los tres: `assign_employee` rechaza una ventana que se solape
    // con otra asignación vigente de la misma persona).
    const shiftCheckIn = await createTodayShift(
      admin,
      client.id,
      siteCheckIn.id,
      -35,
      -22,
    )
    const shiftNoRecord = await createTodayShift(
      admin,
      client.id,
      siteNoRecord.id,
      -18,
      -8,
    )
    const shiftAbsence = await createTodayShift(
      admin,
      client.id,
      siteAbsence.id,
      -5,
      20,
    )

    const assignmentCheckInId = await assignEmployeeToShift(
      shiftCheckIn.shiftId,
      employee.profileId,
    )
    const assignmentNoRecordId = await assignEmployeeToShift(
      shiftNoRecord.shiftId,
      employee.profileId,
    )
    const assignmentAbsenceId = await assignEmployeeToShift(
      shiftAbsence.shiftId,
      employee.profileId,
    )
    void assignmentNoRecordId

    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      await test.step('ADM-10: la asignación sin check-in, pasada la hora de inicio, se ve "Sin registro"', async () => {
        await page.goto('/admin/asistencia')
        await page
          .getByPlaceholder('Buscar por nombre…')
          .fill(employee.lastName)
        const row = page.getByRole('row', {
          name: new RegExp(siteNoRecord.name),
        })
        await expect(row.getByText('Sin registro')).toBeVisible()
      })

      await test.step('ADM-06: hora futura rechazada con el mensaje debajo del campo', async () => {
        await page.goto(`/admin/turnos/${shiftCheckIn.shiftId}`)
        await page.getByRole('button', { name: 'Registrar en nombre' }).click()
        await expect(page.getByText(`Registrar en nombre de`)).toBeVisible()
        // La acción por defecto ya es "Inicio" (sin check-in registrado): se deja el motivo
        // primero, después se fuerza una hora futura pisando el valor del campo (el `max` del
        // input es solo una ayuda del navegador; el formulario tiene `noValidate` y valida a
        // mano, así que hace falta escribir el valor a propósito para probar el rechazo).
        await page
          .getByLabel('Motivo')
          .fill('E2E-P144: avisó por teléfono que ya había llegado')
        const futureValue = toLocalDateTimeValue(
          new Date(Date.now() + 30 * 60_000),
        )
        await page.getByLabel('Hora').fill(futureValue)
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(
          page.getByText(
            'La hora tiene que estar entre las 0:00 del día del turno y este momento.',
          ),
        ).toBeVisible()
      })

      await test.step('ADM-11: registra el inicio "por teléfono" con motivo y hora editada (pasada)', async () => {
        const editedValue = toLocalDateTimeValue(
          new Date(Date.now() - 5 * 60_000),
        )
        await page.getByLabel('Hora').fill(editedValue)
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(page.getByText('Registramos el inicio.')).toBeVisible()
        // Dos coincidencias legítimas ("Inicio real" del resumen y la línea de tiempo, que
        // repite lo mismo con más detalle): alcanza con que la primera sea visible.
        await expect(
          page.getByText(new RegExp(`lo cargó ${ownerFullName}`)).first(),
        ).toBeVisible()
      })

      await test.step('ADM-11: cierra la asignación sin fin (cierre manual, close_assignment)', async () => {
        await page.getByRole('button', { name: 'Registrar en nombre' }).click()
        await page.getByRole('combobox', { name: 'Elegir acción' }).click()
        await page.getByRole('option', { name: 'Cierre manual' }).click()
        await page
          .getByLabel('Motivo')
          .fill('E2E-P144: se olvidó de fichar la salida')
        await page.getByRole('button', { name: 'Cerrar asignación' }).click()
        await expect(page.getByText('Registramos el fin.')).toBeVisible()
      })

      await test.step('En la Base: inicio y fin quedaron con source admin, asignación finished', async () => {
        const records = await fetchAttendanceRecords(admin, assignmentCheckInId)
        const checkIn = records.find((r) => r.kind === 'check_in')
        const checkOut = records.find((r) => r.kind === 'check_out')
        expect(checkIn?.source).toBe('admin')
        expect(checkOut?.source).toBe('admin')
        expect(await fetchAssignmentStatus(admin, assignmentCheckInId)).toBe(
          'finished',
        )
      })

      await test.step('ADM-11: avisa una ausencia en nombre del empleado (P-073, después del inicio efectivo)', async () => {
        await page.goto(`/admin/turnos/${shiftAbsence.shiftId}`)
        await page.getByRole('button', { name: 'Registrar en nombre' }).click()
        await page.getByRole('combobox', { name: 'Elegir acción' }).click()
        await page.getByRole('option', { name: 'Ausencia' }).click()
        await page.getByRole('combobox', { name: 'Elegir motivo' }).click()
        await page
          .getByRole('option', { name: 'Problema de transporte' })
          .click()
        await page.getByRole('button', { name: 'Avisar ausencia' }).click()
        await expect(page.getByText('Avisamos la ausencia.')).toBeVisible()
      })

      await test.step('ADM-06: la línea de tiempo muestra el aviso con quién lo cargó', async () => {
        await expect(
          page.getByText(
            new RegExp(`Aviso de ausencia — lo cargó ${ownerFullName}`),
          ),
        ).toBeVisible()
        // `.first()`: además de la línea de tiempo, el mismo texto queda en el `<select>` nativo
        // oculto de Radix (accesibilidad) mientras el panel sigue montado -- ambigüedad de
        // selector, no del componente.
        await expect(
          page.getByText('Problema de transporte').first(),
        ).toBeVisible()
      })

      await test.step('En la Base: el aviso de ausencia quedó con source admin', async () => {
        const noticesAbsence = await fetchAttendanceNotices(
          admin,
          assignmentAbsenceId,
        )
        expect(noticesAbsence).toHaveLength(1)
        expect(noticesAbsence[0].kind).toBe('absence')
        expect(noticesAbsence[0].reason_code).toBe('transport')
        expect(noticesAbsence[0].source).toBe('admin')
      })

      await test.step('ADM-12: el historial de asistencia del empleado muestra las dos filas', async () => {
        await page.goto(
          `/admin/empleados/${employee.profileId}?pestana=asistencia`,
        )
        await expect(page.getByText(siteCheckIn.name)).toBeVisible()
        await expect(page.getByText(siteAbsence.name)).toBeVisible()
        await expect(
          page.getByText(/Ausencia: Problema de transporte/),
        ).toBeVisible()
      })
    } finally {
      await deactivateDisposableEmployee(admin, employee.profileId)
      await cleanupDisposableClient(admin, client.id)
    }
  })
})

/**
 * Instante dado, como valor de `input type="datetime-local"` en hora de Argentina
 * (`"yyyy-MM-ddTHH:mm"`, mismo formato que `toDateTimeLocal` de `dateTimeLocal.ts` -- copiado acá,
 * no importado, porque esta suite no importa código de `src/` fuera de los tipos generados). Dos
 * `Intl.DateTimeFormat` separados (fecha en `en-CA`, hora en `en-GB` con `hour12: false`), mismo
 * patrón que `argentinaTodayISODate`/`argentinaNowParts` de `shiftFixture.ts` -- evita el defecto
 * conocido de ICU que devuelve "24" en vez de "00" para la medianoche al pedir fecha y hora juntas
 * en un solo `formatToParts` con `hour12: false`.
 */
function toLocalDateTimeValue(date: Date): string {
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(date)
  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const hour = timeParts.find((p) => p.type === 'hour')?.value ?? '00'
  const minute = timeParts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${datePart}T${hour === '24' ? '00' : hour}:${minute}`
}
