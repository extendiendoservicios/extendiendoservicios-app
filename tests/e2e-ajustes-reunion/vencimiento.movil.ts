import { expect, test } from '@playwright/test'
import { getAdminDb } from '../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { fijarConsentimiento, marcarCambiosVistos } from '../fixtures/movil.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'
import { avisarEnCaminoFechado } from './helpers/aviso.ts'
import {
  faltaMargenHaciaAtras,
  franjaDesdeAhora,
  horaArgentina,
} from './helpers/tiempo.ts'

// P19.5h · AJ-02 en el celular (390 px): el aviso «en camino» vence a la hora estimada + 15 min
// (migración 0034, `v_my_day.on_the_way_expires_at`). Con el aviso vencido la tarjeta de Hoy y el
// detalle del servicio dicen «Tu aviso de llegada venció. Si seguís en camino, avisá de nuevo.»,
// no muestran «llegás ~HH:MM» con una hora pasada y el botón pasa a «Avisar de nuevo»; ese botón
// abre la hoja «¿En cuánto llegás?» y manda un aviso nuevo que vuelve a «Avisaste que estás en
// camino · llegás ~HH:MM». Cuenta: empleado3.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.use({ storageState: storageStatePath('empleado3') })

test.describe('empleado: «En camino» vence (AJ-02)', () => {
  test(
    'con el aviso vencido la tarjeta lo dice y «Avisar de nuevo» manda un aviso nuevo vigente',
    cubre('RB-E07', 'RB-E01', 'CB-21'),
    async ({ page }) => {
      // Franja que empezó hace 5 min; el aviso se fecha con la llegada estimada hace 30 min.
      const motivo = faltaMargenHaciaAtras(7)
      test.skip(motivo !== null, motivo ?? '')
      test.setTimeout(180_000)

      const sc = new Scenario()
      try {
        const cliente = await sc.client('encamino-vence')
        const sede = await sc.site(cliente.id, 'encamino-vence')
        const turno = await sc.shift(
          cliente.id,
          sede.id,
          sc.today,
          franjaDesdeAhora(-5, 120),
        )
        const asignacion = await sc.assign(turno, 'empleado3')
        await fijarConsentimiento('empleado3', true)
        await marcarCambiosVistos('empleado3')
        const vencido = await avisarEnCaminoFechado('empleado3', asignacion, {
          llegaEnMin: -30,
        })

        const aviso =
          'Tu aviso de llegada venció. Si seguís en camino, avisá de nuevo.'

        await test.step('Hoy: la tarjeta dice que venció, sin hora pasada, y ofrece «Avisar de nuevo»', async () => {
          await page.goto('/app')
          await expect(page.getByText(sede.name).first()).toBeVisible()
          await expect(page.getByText(aviso)).toBeVisible()
          await expect(
            page.getByText(/Avisaste que estás en camino/),
          ).toHaveCount(0)
          await expect(
            page.getByRole('button', { name: 'Avisar de nuevo' }),
          ).toBeVisible()
          await expect(
            page.getByRole('button', {
              name: /Estoy en camino|Cambiar hora estimada/,
            }),
          ).toHaveCount(0)
          await expectNoHorizontalScroll(page)
        })

        await test.step('el detalle del servicio muestra lo mismo', async () => {
          await page.goto(`/app/servicio/${asignacion}`)
          await expect(page.getByText(aviso)).toBeVisible()
          await expect(
            page.getByRole('button', { name: 'Avisar de nuevo' }),
          ).toBeVisible()
        })

        await test.step('«Avisar de nuevo» abre la hoja y manda un aviso nuevo con la estimación elegida', async () => {
          await page.goto('/app')
          await page.getByRole('button', { name: 'Avisar de nuevo' }).click()
          const hoja = page.getByRole('dialog', { name: '¿En cuánto llegás?' })
          await expect(hoja).toBeVisible()
          await hoja.getByRole('button', { name: '20 min' }).click()
          await hoja.getByRole('button', { name: 'Confirmar' }).click()
          await expect(hoja).toHaveCount(0)

          const { data, error } = await getAdminDb()
            .from('attendance_notices')
            .select('id, estimated_arrival_at, created_at')
            .eq('assignment_id', asignacion)
            .eq('kind', 'on_the_way')
            .order('created_at', { ascending: false })
          expect(error, error?.message).toBeNull()
          expect(data, 'dos avisos: el vencido y el nuevo').toHaveLength(2)
          const nuevo = data![0]
          expect(nuevo.id).not.toBe(vencido)
          const diferencia =
            new Date(nuevo.estimated_arrival_at!).getTime() - Date.now()
          expect(diferencia).toBeGreaterThan(18 * 60_000)
          expect(diferencia).toBeLessThan(21 * 60_000)

          await expect(
            page.getByText(
              `Avisaste que estás en camino · llegás ~${horaArgentina(nuevo.estimated_arrival_at!)}`,
            ),
          ).toBeVisible()
          await expect(page.getByText(aviso)).toHaveCount(0)
          await expect(
            page.getByRole('button', { name: 'Cambiar hora estimada' }),
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: 'Avisar de nuevo' }),
          ).toHaveCount(0)
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
