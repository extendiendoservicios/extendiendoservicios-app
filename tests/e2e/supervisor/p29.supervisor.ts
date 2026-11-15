import { expect, test } from '@playwright/test'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  fichar,
  fijarConsentimiento,
  FRANJAS_MOVIL,
  POSICION_SIMULADA,
} from '../../fixtures/movil.ts'
import { ponerObservacion } from '../../fixtures/p29.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P29.6 (P29.5: OG-05, propuesta aprobada por omisión): el coordinador ve el «Mensaje de la oficina»
// de un turno en su supervisión: en la lista de Supervisiones y en el detalle. Sin supervisión de ese
// turno no hay mensaje. Cuenta: supervisor1; empleado: empleado2 (ya fichó). La observación se carga
// como la app (`update_shift_details`).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({
  storageState: storageStatePath('supervisor1'),
  geolocation: POSICION_SIMULADA,
  permissions: ['geolocation'],
})

test(
  'el coordinador ve el «Mensaje de la oficina» en la lista de Supervisiones y en el detalle del turno que supervisa',
  cubre('RB-S01', 'RB-S04', 'OG-05'),
  async ({ page }) => {
    test.setTimeout(300_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('og05-sup')
      const sede = await sc.site(cliente.id, 'og05-sup')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
      )
      const asignacion = await sc.assign(turno, 'empleado2')
      await fijarConsentimiento('empleado2', true)
      await fichar('empleado2', asignacion, 'inicio')
      const mensaje =
        'e2e-og05: la llave está con el encargado de la planta baja.'
      await ponerObservacion(turno, mensaje)
      await sc.tomarCoordinador('supervisor1')
      await fijarConsentimiento('supervisor1', true)

      await test.step('sin supervisar el turno, el coordinador no ve el mensaje en Supervisiones', async () => {
        await page.goto('/sup/supervisiones')
        await expect(page.getByText('Cargando…')).toHaveCount(0)
        await expect(page.getByText(mensaje)).toHaveCount(0)
      })

      const supervision = await sc.tomarSupervision(turno, 'supervisor1')

      await test.step('al tomar el turno, la lista de Supervisiones trae el mensaje en la tarjeta', async () => {
        await page.goto('/sup/supervisiones')
        const tarjeta = page.locator(
          `a[href="/sup/supervisiones/${supervision}"]`,
        )
        await expect(tarjeta).toBeVisible()
        const caja = tarjeta.getByTestId('office-message')
        await expect(caja).toContainText('Mensaje de la oficina')
        await expect(caja).toContainText(mensaje)
        await expectNoHorizontalScroll(page)
      })

      await test.step('el detalle de la supervisión muestra el mensaje completo', async () => {
        await page.goto(`/sup/supervisiones/${supervision}`)
        const caja = page.getByTestId('office-message')
        await expect(caja).toContainText('Mensaje de la oficina')
        await expect(caja).toContainText(mensaje)
        await expectNoHorizontalScroll(page)
      })

      await test.step('si la oficina cambia el mensaje, el coordinador ve el nuevo', async () => {
        const nuevo = 'e2e-og05: cambio de plan, supervisar después de las 15.'
        await ponerObservacion(turno, nuevo)
        await page.reload()
        await expect(page.getByTestId('office-message')).toContainText(nuevo)
        await expect(page.getByText(mensaje)).toHaveCount(0)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
