import { expect, test } from '@playwright/test'
import {
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-016 (P18.1): asistencia administrativa (RB-A06, RB-A08), flujo crítico 7 de
// `03_Plan_Maestro_Tecnico.md` sección 14.2.
//   - CB-05 (P-069): el empleado nunca registra el fin; el tablero lo lista "en curso pasada la
//     hora de fin" y el administrador cierra la asignación con motivo.
//   - CB-07 (6.2 del modelo): un empleado con ausencia avisada igual puede registrar el inicio;
//     el estado pasa a `present` y el aviso queda en el historial.
// Las franjas son la de la madrugada (00:00–00:01), que ya terminó a cualquier hora del día:
// por eso se saltea en los primeros minutos después de las 0:00.
// Empleados de este archivo: empleado3 y empleado4.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

test.describe('asistencia administrativa (ADM-02, ADM-06, ADM-10, ADM-11, ADM-12)', () => {
  test(
    'CB-05: el empleado nunca registra el fin; el tablero lo marca y el administrador cierra con motivo',
    cubre('RB-A06', 'RB-A08', 'CB-05', 'P-069', 'P-075'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const client = await sc.client('sinfin')
        const site = await sc.site(client.id, 'sinfin')
        const shiftId = await sc.shift(
          client.id,
          site.id,
          sc.today,
          FRANJAS.madrugada,
        )
        const assignmentId = await sc.assign(shiftId, 'empleado3')
        const empleado = await sessionClient('empleado3')
        const inicio = await empleado.rpc('record_check_in', {
          p_assignment_id: assignmentId,
        })
        expect(inicio.error, inicio.error?.message).toBeNull()
        // El formulario de ADM-11 propone la hora "ahora" redondeada al minuto: si el inicio se
        // registró hace segundos, el cierre quedaría unos segundos ANTES del inicio. Se corre el
        // inicio a la madrugada del día del turno, como si el empleado hubiera fichado hace horas.
        const corrido = await sc.db
          .from('attendance_records')
          .update({ recorded_at: `${sc.today}T00:00:30-03:00` })
          .eq('assignment_id', assignmentId)
          .eq('kind', 'check_in')
        expect(corrido.error, corrido.error?.message).toBeNull()

        const titulo = 'E2E-Fijo Empleado3 sigue en curso pasada su hora de fin'

        await test.step('ADM-02: la asignación queda en "Requiere atención", todavía presente', async () => {
          await page.goto('/admin')
          const tarjeta = page.getByRole('listitem').filter({ hasText: titulo })
          await expect(tarjeta).toContainText(
            `${client.name} · ${site.name} · 00:00–00:01`,
          )
          const { data } = await sc.db
            .from('assignments')
            .select('status')
            .eq('id', assignmentId)
            .single()
          expect(
            data?.status,
            'sin fin registrado la asignación sigue presente',
          ).toBe('present')
        })

        await test.step('el administrador cierra la asignación con motivo (cierre manual)', async () => {
          const tarjeta = page.getByRole('listitem').filter({ hasText: titulo })
          await tarjeta
            .getByRole('button', { name: 'Registrar en nombre' })
            .click()
          await page.getByRole('combobox', { name: 'Elegir acción' }).click()
          await page.getByRole('option', { name: 'Cierre manual' }).click()
          await page.getByRole('button', { name: 'Cerrar asignación' }).click()
          await expect(page.getByText(/motivo/i).first()).toBeVisible()
          await page
            .getByLabel('Motivo')
            .fill('e2e: se olvidó de fichar la salida')
          await page.getByRole('button', { name: 'Cerrar asignación' }).click()
          await expect(page.getByText('Registramos el fin.')).toBeVisible()
        })

        await test.step('quedó cerrada: asignación finalizada, turno completado, fin cargado por administración', async () => {
          const { data: asignacion } = await sc.db
            .from('assignments')
            .select('status')
            .eq('id', assignmentId)
            .single()
          expect(asignacion?.status).toBe('finished')
          const { data: turno } = await sc.db
            .from('shifts')
            .select('status')
            .eq('id', shiftId)
            .single()
          expect(turno?.status).toBe('completed')
          const { data: fin } = await sc.db
            .from('attendance_records')
            .select('source, reason')
            .eq('assignment_id', assignmentId)
            .eq('kind', 'check_out')
            .single()
          expect(fin?.source).toBe('admin')
          expect(fin?.reason).toContain('se olvidó de fichar')
          await page.goto('/admin')
          await expect(
            page.getByRole('listitem').filter({ hasText: titulo }),
          ).toHaveCount(0)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'CB-07: con una ausencia avisada, el empleado igual registra el inicio; pasa a presente y el aviso queda en el historial',
    cubre('RB-A06', 'RB-A08', 'CB-07'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const client = await sc.client('avisoinicio')
        const site = await sc.site(client.id, 'avisoinicio')
        const shiftId = await sc.shift(
          client.id,
          site.id,
          sc.today,
          FRANJAS.madrugada,
        )
        const assignmentId = await sc.assign(shiftId, 'empleado4')

        // La ausencia la carga la administración en nombre del empleado (P-073: antes o después
        // del inicio efectivo mientras no haya inicio registrado).
        const admin = await sessionClient('admin')
        const aviso = await admin.rpc('notify_absence', {
          p_assignment_id: assignmentId,
          p_reason_code: 'illness',
        })
        expect(aviso.error, aviso.error?.message).toBeNull()

        await test.step('ADM-10: la asignación figura con la ausencia avisada', async () => {
          await page.goto('/admin/asistencia')
          await page.getByPlaceholder('Buscar por nombre…').fill('Empleado4')
          const fila = page.getByRole('row').filter({ hasText: client.name })
          await expect(fila).toContainText(/Ausencia avisada/i)
        })

        await test.step('el empleado registra el inicio igual (permitido)', async () => {
          const empleado = await sessionClient('empleado4')
          const inicio = await empleado.rpc('record_check_in', {
            p_assignment_id: assignmentId,
          })
          expect(inicio.error, inicio.error?.message).toBeNull()
          const { data } = await sc.db
            .from('assignments')
            .select('status')
            .eq('id', assignmentId)
            .single()
          expect(data?.status).toBe('present')
        })

        await test.step('ADM-10 y ADM-06: figura presente y el aviso queda en el historial', async () => {
          await page.goto('/admin/asistencia')
          await page.getByPlaceholder('Buscar por nombre…').fill('Empleado4')
          const fila = page.getByRole('row').filter({ hasText: client.name })
          await expect(fila).toContainText('Presente')

          await page.goto(`/admin/turnos/${shiftId}`)
          const detalle = page.getByRole('dialog', {
            name: 'Detalle del turno',
          })
          await expect(detalle.getByText(/Aviso de ausencia/)).toBeVisible()

          const { data: avisos } = await sc.db
            .from('attendance_notices')
            .select('kind')
            .eq('assignment_id', assignmentId)
          expect(
            avisos?.map((a) => a.kind),
            'el aviso no se borra',
          ).toEqual(['absence'])
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
