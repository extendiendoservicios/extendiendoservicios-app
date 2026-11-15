import { expect, test } from '@playwright/test'
import {
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  contextoDe,
  esperarHoy,
  FRANJAS_MOVIL,
  marcarCambiosVistos,
} from '../../fixtures/movil.ts'
import { ponerObservacion } from '../../fixtures/p29.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// P29.6 (P29.5: OG-05), celular 390 px y WebKit: el «Mensaje de la oficina», la observación del turno
// que carga la administración, la ven los empleados asignados en Hoy y en el detalle del servicio;
// un empleado que no está asignado no la ve; si cambia, el turno entra en «Cambios desde tu última
// visita» con «Nuevo mensaje de la oficina». La observación se carga como lo hace la app
// (`update_shift_details`, queda en `shift_observations`), nunca en `shifts.notes`.
// Cuentas: empleado1 (asignado) y empleado2 (no asignado, solo mira).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('empleado1') })

test(
  'el empleado asignado ve el «Mensaje de la oficina» en Hoy y en el detalle; el no asignado no lo ve',
  cubre('RB-E02', 'RB-E03', 'CB-15', 'OG-05'),
  async ({ page, browser }, testInfo) => {
    test.setTimeout(240_000)
    const sc = new Scenario()
    const otro = await contextoDe(browser, testInfo, 'empleado2')
    try {
      const cliente = await sc.client('og05-emp')
      const sede = await sc.site(cliente.id, 'og05-emp')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
      )
      const asignacion = await sc.assign(turno, 'empleado1')
      const mensaje = `e2e-og05: entrá por el portón de atrás.\nLlevá la llave del depósito.`
      await ponerObservacion(turno, mensaje)
      await marcarCambiosVistos('empleado1')

      await test.step('en la base la observación vive en shift_observations y shifts.notes sigue vacía', async () => {
        const { data: obs } = await sc.db
          .from('shift_observations')
          .select('observation')
          .eq('shift_id', turno)
          .single()
        expect(obs?.observation).toBe(mensaje)
        const { data: t } = await sc.db
          .from('shifts')
          .select('notes')
          .eq('id', turno)
          .single()
        expect(t?.notes ?? null).toBeNull()
      })

      await test.step('Hoy: la tarjeta del servicio trae el mensaje, con sus saltos de línea', async () => {
        await page.goto('/app')
        await esperarHoy(page)
        const tarjeta = page.locator('a', { hasText: sede.name })
        const caja = tarjeta.getByTestId('office-message')
        await expect(caja).toContainText('Mensaje de la oficina')
        await expect(caja).toContainText('entrá por el portón de atrás.')
        await expect(caja).toContainText('Llevá la llave del depósito.')
        await expectNoHorizontalScroll(page)
      })

      await test.step('detalle del servicio: el mismo mensaje, completo', async () => {
        await page.goto(`/app/servicio/${asignacion}`)
        const caja = page.getByTestId('office-message')
        await expect(caja).toContainText('Mensaje de la oficina')
        await expect(caja).toContainText('Llevá la llave del depósito.')
        await expectNoHorizontalScroll(page)
      })

      await test.step('un empleado que no está asignado no ve el turno ni el mensaje', async () => {
        const ajena = await otro.newPage()
        await ajena.goto('/app')
        await esperarHoy(ajena)
        await expect(ajena.getByText(sede.name)).toHaveCount(0)
        await expect(
          ajena.getByText('entrá por el portón de atrás.'),
        ).toHaveCount(0)
        await expect(ajena.getByTestId('office-message')).toHaveCount(0)
        const lectura = await ajena.evaluate(() => document.body.innerText)
        expect(lectura).not.toContain('portón de atrás')
      })
    } finally {
      await otro.close()
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'sin observación no hay «Mensaje de la oficina» (ni caja vacía) en Hoy ni en el detalle',
  cubre('RB-E02', 'OG-05'),
  async ({ page }) => {
    test.setTimeout(240_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('og05-vacio')
      const sede = await sc.site(cliente.id, 'og05-vacio')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
      )
      const asignacion = await sc.assign(turno, 'empleado1')
      await marcarCambiosVistos('empleado1')
      await page.goto('/app')
      await esperarHoy(page)
      await expect(page.getByText(sede.name).first()).toBeVisible()
      await expect(page.getByTestId('office-message')).toHaveCount(0)
      await page.goto(`/app/servicio/${asignacion}`)
      await expect(page.getByText(sede.name).first()).toBeVisible()
      await expect(page.getByTestId('office-message')).toHaveCount(0)
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'si la administración cambia la observación, el turno aparece en «Cambios desde tu última visita» con «Nuevo mensaje de la oficina»',
  cubre('RB-E02', 'P-092', 'OG-05'),
  async ({ page }) => {
    test.setTimeout(240_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('og05-cambio')
      const sede = await sc.site(cliente.id, 'og05-cambio')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
      )
      await sc.assign(turno, 'empleado1')
      const primero = 'e2e-og05: mensaje inicial de la oficina'
      const segundo = 'e2e-og05: cambio de plan, avisen al encargado'
      await ponerObservacion(turno, primero)
      await marcarCambiosVistos('empleado1')

      await test.step('primera visita: se ve el mensaje y no hay cambios que avisar', async () => {
        const marcado = page.waitForResponse((r) =>
          r.url().includes('/rpc/mark_changes_seen'),
        )
        await page.goto('/app')
        await expect(page.getByTestId('office-message')).toContainText(primero)
        await marcado
        await expect(
          page.getByText('Cambios desde tu última visita'),
        ).toHaveCount(0)
      })

      await test.step('la oficina cambia el mensaje: al volver, el aviso lo dice y la tarjeta trae el nuevo texto', async () => {
        await ponerObservacion(turno, segundo)
        await page.reload()
        await esperarHoy(page)
        const cambios = page
          .getByRole('alert')
          .filter({ hasText: 'Cambios desde tu última visita' })
        await expect(cambios).toContainText(sede.name)
        await expect(cambios).toContainText('Nuevo mensaje de la oficina')
        await expect(page.getByTestId('office-message').first()).toContainText(
          segundo,
        )
        await expect(page.getByText(primero)).toHaveCount(0)
      })

      await test.step('ya visto: la próxima vez el aviso no vuelve, y el mensaje sigue en la tarjeta', async () => {
        await page.reload()
        await esperarHoy(page)
        await expect(
          page.getByText('Cambios desde tu última visita'),
        ).toHaveCount(0)
        await expect(page.getByText('Nuevo mensaje de la oficina')).toHaveCount(
          0,
        )
        await expect(page.getByTestId('office-message').first()).toContainText(
          segundo,
        )
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
