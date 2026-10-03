import { expect, test } from '@playwright/test'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  calificar,
  fichar,
  FRANJAS_MOVIL,
  fijarConsentimiento,
  marcarCambiosVistos,
  supervisionFichar,
} from '../../fixtures/movil.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-017 (P18.2): MOB-SUP-014, "el empleado no ve calificaciones" (RB-S04, P-084, CB-15).
// Decisión de Mike (3 oct 2026): alcanza con que las rutas de supervisor y de administración lo
// redirijan y que la API le devuelva cero filas en `ratings`. Se hace con una calificación REAL
// ya cargada sobre el propio empleado: sin ella "cero filas" no probaría nada.
// Cuentas: empleado1 (quien mira), supervisor1 (califica).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('empleado1') })

test(
  'MOB-SUP-014: con una calificación cargada sobre él, el empleado no la ve por pantalla ni por API',
  cubre('RB-S04', 'RB-X02', 'CB-15', 'P-084'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('sin-notas')
      const sede = await sc.site(cliente.id, 'sin-notas')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
      )
      const asignacion = await sc.assign(turno, 'empleado1')
      const supervision = await sc.assignSupervision(turno, 'supervisor1')
      await fijarConsentimiento('empleado1', true)
      await marcarCambiosVistos('empleado1')
      await fichar('empleado1', asignacion, 'inicio')
      await fichar('empleado1', asignacion, 'fin')
      await supervisionFichar('supervisor1', supervision, 'inicio')
      await calificar(
        'supervisor1',
        supervision,
        asignacion,
        2,
        'e2e-sin-notas: comentario que el empleado no puede ver',
      )

      await test.step('hay una calificación real sobre este empleado (la ve quien debe)', async () => {
        const { data } = await sc.db
          .from('ratings')
          .select('score')
          .eq('supervision_id', supervision)
        expect(data).toEqual([{ score: 2 }])
      })

      await test.step('API (CB-15): ratings, supervision_attendance y supervisions devuelven cero filas', async () => {
        const api = await sessionClient('empleado1')
        for (const tabla of [
          'ratings',
          'supervision_attendance',
          'supervisions',
        ] as const) {
          const { data, error } = await api.from(tabla).select('*')
          expect(error, `${tabla}: ${error?.message}`).toBeNull()
          expect(data, `${tabla} tiene que venir vacía`).toEqual([])
        }
        const vista = await api.from('v_my_supervisions').select('*')
        expect(vista.data ?? []).toEqual([])
      })

      await test.step('pantalla: sus propias pantallas no muestran puntaje ni comentario', async () => {
        for (const ruta of [
          '/app',
          `/app/servicio/${asignacion}`,
          `/app/resumen/${asignacion}`,
        ]) {
          await page.goto(ruta)
          await expect(page.getByText(sede.name).first()).toBeVisible()
          await expect(page.getByText(/calificaci/i)).toHaveCount(0)
          await expect(
            page.getByRole('img', { name: /de 5 estrellas/ }),
          ).toHaveCount(0)
          await expect(page.getByText('e2e-sin-notas: comentario')).toHaveCount(
            0,
          )
        }
      })

      await test.step('rutas de supervisor y de administración lo devuelven a su vía', async () => {
        for (const ruta of [
          '/sup',
          '/sup/historial',
          '/sup/supervisiones',
          `/sup/supervisiones/${supervision}`,
          `/sup/supervisiones/${supervision}/calificar/${asignacion}`,
          '/admin',
          '/admin/supervisiones',
        ]) {
          // `commit`: la redirección ocurre en el cliente y en WebKit interrumpe la espera de "load".
          await page.goto(ruta, { waitUntil: 'commit' })
          await expect(page, `${ruta} debería redirigir`).toHaveURL(/\/app$/)
        }
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
