import { expect, test } from '@playwright/test'
import { expectHint } from '../../fixtures/api.ts'
import {
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  calificar,
  FRANJAS_MOVIL,
  supervisionFichar,
} from '../../fixtures/movil.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-018 (P18.2): lo que el supervisor NO puede hacer, por pantalla y por API directa
// (RB-S02, RB-S03, RB-S04, RB-X02, P-020, P-083, P-084; CB-14 por pantalla). La persona que mira
// es supervisor2; la dueña de la supervisión es supervisor1. Empleados: empleado1 y empleado2.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('supervisor2') })

test(
  'la supervisión de otra persona no es accesible: ni por pantalla ni por API (RB-S02, RB-S03, P-084)',
  cubre('RB-S02', 'RB-S03', 'RB-S04', 'RB-X02', 'CB-15', 'P-020', 'P-084'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('sup-ajena')
      const sede = await sc.site(cliente.id, 'sup-ajena')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
      )
      const asignacion = await sc.assign(turno, 'empleado1')
      const supervision = await sc.assignSupervision(turno, 'supervisor1')
      await supervisionFichar('supervisor1', supervision, 'inicio')
      await calificar('supervisor1', supervision, asignacion, 3, 'e2e: ajena')

      await test.step('control positivo: la dueña sí ve su supervisión y su calificación', async () => {
        const duena = await sessionClient('supervisor1')
        const sups = await duena
          .from('supervisions')
          .select('id')
          .eq('id', supervision)
        expect(sups.data).toHaveLength(1)
        const notas = await duena
          .from('ratings')
          .select('score')
          .eq('supervision_id', supervision)
        expect(notas.data).toEqual([{ score: 3 }])
      })

      await test.step('pantallas: Hoy no la lista y las rutas dicen que no la encuentran', async () => {
        await page.goto('/sup')
        await expect(page.getByText('No tenés supervisiones hoy')).toBeVisible()
        await page.goto(`/sup/supervisiones/${supervision}`)
        await expect(
          page.getByText('No encontramos esa supervisión.'),
        ).toBeVisible()
        await expect(page.getByText(sede.name)).toHaveCount(0)
        await page.goto(`/sup/supervisiones/${supervision}/registro`)
        await expect(
          page.getByText('No encontramos esa supervisión.'),
        ).toBeVisible()
        await page.goto(`/sup/supervisiones/${supervision}/cerrar`)
        await expect(
          page.getByText('No encontramos esa supervisión.'),
        ).toBeVisible()
        await page.goto(
          `/sup/supervisiones/${supervision}/calificar/${asignacion}`,
        )
        await expect(
          page.getByRole('button', { name: 'Guardar calificación' }),
        ).toHaveCount(0)
      })

      await test.step('pantallas: no hay vía de empleado ni de administración (redirige a /sup)', async () => {
        for (const ruta of [
          '/app',
          '/app/mas',
          '/admin',
          '/admin/supervisiones',
        ]) {
          await page.goto(ruta)
          await expect(page, `${ruta} debería redirigir`).toHaveURL(/\/sup$/)
        }
      })

      await test.step('API: cero filas de lo ajeno (supervisión, asistencia, calificaciones, turno, asignaciones)', async () => {
        const api = await sessionClient('supervisor2')
        const lecturas = await Promise.all([
          api.from('supervisions').select('id').eq('id', supervision),
          api
            .from('supervision_attendance')
            .select('id')
            .eq('supervision_id', supervision),
          api.from('ratings').select('id').eq('supervision_id', supervision),
          api.from('shifts').select('id').eq('id', turno),
          api.from('assignments').select('id').eq('shift_id', turno),
        ])
        for (const [i, lectura] of lecturas.entries()) {
          expect(
            lectura.error,
            `lectura ${i}: ${lectura.error?.message}`,
          ).toBeNull()
          expect(lectura.data, `lectura ${i} tiene que venir vacía`).toEqual([])
        }
      })

      await test.step('API: las RPC sobre la supervisión ajena fallan', async () => {
        const api = await sessionClient('supervisor2')
        expectHint(
          await api.rpc('rate_employee', {
            p_supervision_id: supervision,
            p_assignment_id: asignacion,
            p_score: 5,
          }),
          'NOT_YOUR_SUPERVISION',
        )
        expectHint(
          await api.rpc('supervision_check_in', {
            p_supervision_id: supervision,
          }),
          'NOT_YOUR_SUPERVISION',
        )
        expectHint(
          await api.rpc('mark_supervision_not_done', {
            p_supervision_id: supervision,
            p_reason: 'e2e',
          }),
          'NOT_YOUR_SUPERVISION',
        )
        expectHint(
          await api.rpc('assign_supervision', {
            p_shift_id: turno,
            p_supervisor_id: (
              await sc.db
                .from('supervisions')
                .select('supervisor_id')
                .eq('id', supervision)
                .single()
            ).data!.supervisor_id,
          }),
          'FORBIDDEN',
        )
      })

      await test.step('la calificación de la dueña quedó intacta', async () => {
        const { data } = await sc.db
          .from('ratings')
          .select('score')
          .eq('supervision_id', supervision)
        expect(data).toEqual([{ score: 3 }])
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'CB-14 por pantalla: pasado el plazo (fin previsto y fin registrado) ya no se ofrece calificar y el servidor lo rechaza',
  cubre('CB-14', 'RB-S04', 'P-083'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('sup-plazo')
      const sede = await sc.site(cliente.id, 'sup-plazo')
      // 00:00–00:01: el fin previsto ya pasó; al registrar el fin, la ventana de P-083
      // (`now() <= greatest(fin previsto, fin registrado)`) se cierra al instante.
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS.madrugada,
      )
      const asignacion = await sc.assign(turno, 'empleado2')
      const supervision = await sc.assignSupervision(turno, 'supervisor2')
      await supervisionFichar('supervisor2', supervision, 'inicio')
      await supervisionFichar('supervisor2', supervision, 'fin')
      // La pantalla anticipa el plazo con el reloj del dispositivo: se espera a que ese reloj
      // pase la hora del fin que puso el servidor (puede estar unos segundos adelantado).
      const { data: fin } = await sc.db
        .from('supervision_attendance')
        .select('recorded_at')
        .eq('supervision_id', supervision)
        .eq('kind', 'check_out')
        .single()
      await expect
        .poll(() => Date.now() > new Date(fin!.recorded_at).getTime() + 2_000, {
          intervals: [500],
        })
        .toBe(true)

      await page.goto(`/sup/supervisiones/${supervision}`)
      await expect(
        page.getByText('El plazo para calificar a este turno ya cerró.'),
      ).toBeVisible()
      const fila = page
        .locator('div.flex.items-center.justify-between.gap-2')
        .filter({ hasText: 'E2E-Fijo Empleado2' })
      await expect(fila).toBeVisible()
      await expect(
        fila.getByRole('link', { name: /Calificar|Editar/ }),
      ).toHaveCount(0)

      const api = await sessionClient('supervisor2')
      expectHint(
        await api.rpc('rate_employee', {
          p_supervision_id: supervision,
          p_assignment_id: asignacion,
          p_score: 4,
        }),
        'RATING_WINDOW_CLOSED',
      )
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
