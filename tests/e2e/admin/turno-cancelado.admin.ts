import { expect, test } from '@playwright/test'
import {
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { expectHint } from '../../fixtures/api.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { signedClient, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-016 (P18.1): CB-03, "turno cancelado con empleado ya presente" (P-049).
//   - Lo cancela el dueño o un administrador con `cancel_shifts` (06 sección 7); sin esa
//     capacidad, FORBIDDEN.
//   - Se conserva el registro (asignación y asistencia quedan para el historial).
//   - Las supervisiones `assigned` del turno se cancelan con él.
//   - El empleado ve el turno cancelado en su pantalla Hoy (02_Decisiones.md, P-049).
// Empleado de este archivo: empleado2. Supervisor: supervisor2.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.describe('CB-03: cancelar un turno en curso con un empleado presente', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'el dueño cancela con motivo; se conserva el registro y la supervisión asignada se cancela con el turno',
    cubre('RB-A04', 'CB-03', 'CB-17', 'P-049'),
    async ({ page }) => {
      const sc = new Scenario()
      try {
        const client = await sc.client('cancela')
        const site = await sc.site(client.id, 'cancela')
        // Franja 00:00–00:01: a cualquier hora del día ya empezó, así que el empleado puede
        // registrar el inicio y el turno queda `in_progress`.
        const shiftId = await sc.shift(
          client.id,
          site.id,
          sc.today,
          FRANJAS.madrugada,
        )
        const assignmentId = await sc.assign(shiftId, 'empleado2')
        const supervisionId = await sc.assignSupervision(shiftId, 'supervisor2')

        const empleado = await sessionClient('empleado2')
        const checkIn = await empleado.rpc('record_check_in', {
          p_assignment_id: assignmentId,
        })
        expect(checkIn.error, checkIn.error?.message).toBeNull()
        const { data: enCurso } = await sc.db
          .from('shifts')
          .select('status')
          .eq('id', shiftId)
          .single()
        expect(enCurso?.status).toBe('in_progress')

        await test.step('un administrador sin cancel_shifts no puede cancelarlo (CB-17)', async () => {
          const api = await signedClient('adminSinCapacidades')
          expectHint(
            await api.rpc('cancel_shift', {
              p_shift_id: shiftId,
              p_reason: 'e2e',
            }),
            'FORBIDDEN',
          )
        })

        await test.step('el dueño lo cancela desde ADM-05; el motivo es obligatorio', async () => {
          await page.goto(`/admin/planificacion?vista=dia&fecha=${sc.today}`)
          const fila = page.getByRole('row').filter({ hasText: client.name })
          await fila.getByRole('button', { name: 'Cancelar' }).click()
          const dialogo = page.getByRole('dialog', { name: 'Cancelar turno' })
          await expect(dialogo).toBeVisible()
          await expect(
            dialogo.getByRole('button', { name: 'Cancelar turno' }),
            'sin motivo no se puede confirmar',
          ).toBeDisabled()
          await dialogo
            .getByLabel('Motivo de la cancelación')
            .fill('e2e: el cliente suspendió el servicio')
          await dialogo.getByRole('button', { name: 'Cancelar turno' }).click()
          await expect(page.getByText('Cancelamos el turno.')).toBeVisible()
        })

        await test.step('se conserva el registro y la supervisión asignada queda cancelada', async () => {
          const { data: shift } = await sc.db
            .from('shifts')
            .select('status, cancel_reason, cancelled_by')
            .eq('id', shiftId)
            .single()
          expect(shift?.status).toBe('cancelled')
          expect(shift?.cancel_reason).toContain('el cliente suspendió')
          expect(shift?.cancelled_by).not.toBeNull()

          const { data: assignment } = await sc.db
            .from('assignments')
            .select('status, removed_at')
            .eq('id', assignmentId)
            .single()
          expect(
            assignment?.status,
            'la asignación queda para el historial',
          ).toBe('present')
          expect(assignment?.removed_at).toBeNull()

          const { data: records } = await sc.db
            .from('attendance_records')
            .select('kind')
            .eq('assignment_id', assignmentId)
          expect(records?.map((r) => r.kind)).toEqual(['check_in'])

          const { data: supervision } = await sc.db
            .from('supervisions')
            .select('status')
            .eq('id', supervisionId)
            .single()
          expect(supervision?.status).toBe('cancelled')
        })

        await test.step('ADM-05 lo muestra como Cancelado y ya no ofrece Cancelar', async () => {
          await page.reload()
          const fila = page.getByRole('row').filter({ hasText: client.name })
          await expect(fila.getByText('Cancelado')).toBeVisible()
          await expect(
            fila.getByRole('button', { name: 'Cancelar' }),
          ).toHaveCount(0)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  // DEFECTO DEF-01 (mayor): 02_Decisiones.md P-049 y 05 (EMP-03, "Cambios desde tu última visita:
  // turnos nuevos, cancelados o con horario cambiado") dicen que el empleado ve el turno
  // cancelado en Hoy con indicador de cambio. `v_my_day` filtra `shift.status <> 'cancelled'`
  // (0011_views.sql), así que el turno cancelado desaparece y Hoy dice "No tenés servicios hoy".
  test(
    'el empleado ve el turno cancelado en Hoy con indicador de cambio',
    {
      ...cubre('RB-E02', 'CB-03', 'P-049'),
      annotation: [
        ...cubre('RB-E02', 'CB-03', 'P-049').annotation,
        {
          type: 'defecto',
          description:
            'DEF-01 (mayor): v_my_day excluye los turnos cancelados; el empleado no se entera de la cancelación (P-049, EMP-03).',
        },
      ],
    },
    async ({ browser }) => {
      test.fail(
        true,
        'DEF-01: v_my_day oculta los turnos cancelados (P-049 pide mostrarlos con indicador)',
      )
      const sc = new Scenario()
      try {
        const client = await sc.client('cancelado-hoy')
        const site = await sc.site(client.id, 'cancelado-hoy')
        const shiftId = await sc.shift(
          client.id,
          site.id,
          sc.today,
          FRANJAS.noche,
        )
        await sc.assign(shiftId, 'empleado2')
        const owner = await sessionClient('owner')
        const cancel = await owner.rpc('cancel_shift', {
          p_shift_id: shiftId,
          p_reason: 'e2e: cancelado',
        })
        expect(cancel.error, cancel.error?.message).toBeNull()

        const ctx = await browser.newContext({
          storageState: storageStatePath('empleado2'),
        })
        const page = await ctx.newPage()
        try {
          await page.goto('/app')
          await expect(page.getByRole('main')).toContainText(client.name, {
            timeout: 8_000,
          })
          await expect(page.getByRole('main')).toContainText(/cancelad/i)
        } finally {
          await ctx.close()
        }
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  // DEFECTO DEF-02 (menor): 05 ADM-06 lista `cancel_shift (capacidad)` entre las acciones del
  // detalle del turno; hoy "Cancelar" solo existe en la lista del día (ADM-05).
  test(
    'ADM-06 ofrece "Cancelar turno" (acción del detalle según 05)',
    {
      ...cubre('RB-A04'),
      annotation: [
        ...cubre('RB-A04').annotation,
        {
          type: 'defecto',
          description:
            'DEF-02 (menor): el detalle del turno (ADM-06) no tiene la acción cancel_shift que lista 05_Pantallas; solo está en ADM-05.',
        },
      ],
    },
    async ({ page }) => {
      test.fail(true, 'DEF-02: ADM-06 no ofrece cancelar el turno')
      const sc = new Scenario()
      try {
        const client = await sc.client('detalle-cancelar')
        const site = await sc.site(client.id, 'detalle-cancelar')
        const shiftId = await sc.shift(
          client.id,
          site.id,
          sc.today,
          FRANJAS.noche,
        )
        await page.goto(`/admin/turnos/${shiftId}`)
        const detalle = page.getByRole('dialog', { name: 'Detalle del turno' })
        await expect(detalle.getByText('Dotación: 0/1')).toBeVisible()
        await expect(
          detalle.getByRole('button', { name: /Cancelar turno/ }),
        ).toBeVisible({
          timeout: 3_000,
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
