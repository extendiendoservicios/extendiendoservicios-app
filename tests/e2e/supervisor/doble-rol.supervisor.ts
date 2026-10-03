import { expect, test } from '@playwright/test'
import { expectHint } from '../../fixtures/api.ts'
import {
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  FRANJAS_MOVIL,
  fijarConsentimiento,
  marcarCambiosVistos,
  supervisionFichar,
} from '../../fixtures/movil.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-018 (P18.2): el doble rol empleado y supervisor (`e2e-fijo-dual`): el ingreso va a la vía
// de empleado, "Más" ofrece "Supervisión" (EMP-13) y "Mis servicios" (SUP-09) con los enlaces
// reales, cada vía muestra solo lo suyo, y CB-13 (supervisor que también trabaja como empleado
// del turno: se ve "Vos", no puede calificarse y el servidor lo rechaza con
// `SELF_RATING_NOT_ALLOWED`). RB-E01, RB-S01, RB-S04, P-042, P-122. Cuentas: dual; empleado1 es
// el compañero del turno.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('dual') })

test(
  'el doble rol ingresa a la vía de empleado y cruza a supervisión y de vuelta con los enlaces de "Más"',
  cubre('RB-E01', 'RB-S01', 'P-122', 'P-042'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('dual-cruce')
      const sedeEmpleado = await sc.site(cliente.id, 'dual-empleado')
      const sedeSupervision = await sc.site(cliente.id, 'dual-supervision')
      // Como empleado: un turno propio. Como supervisor: otro turno distinto, con otra persona.
      const turnoPropio = await sc.shift(
        cliente.id,
        sedeEmpleado.id,
        sc.today,
        FRANJAS.manana,
      )
      await sc.assign(turnoPropio, 'dual')
      const turnoSupervisado = await sc.shift(
        cliente.id,
        sedeSupervision.id,
        sc.today,
        FRANJAS.tarde,
      )
      await sc.assign(turnoSupervisado, 'empleado1')
      await sc.assignSupervision(turnoSupervisado, 'dual')
      await marcarCambiosVistos('dual')

      await test.step('al entrar, el inicio es el de empleado (COM-01): Hoy con su servicio, sin la supervisión', async () => {
        await page.goto('/', { waitUntil: 'commit' })
        await expect(page).toHaveURL(/\/app$/)
        await expect(page.getByText(sedeEmpleado.name)).toBeVisible()
        await expect(page.getByText(sedeSupervision.name)).toHaveCount(0)
      })

      await test.step('EMP-13 Más ofrece "Supervisión" y lleva a SUP-02', async () => {
        await page
          .getByRole('navigation', { name: 'Navegación principal' })
          .getByRole('link', { name: 'Más' })
          .click()
        await expect(page).toHaveURL(/\/app\/mas$/)
        await page.getByRole('link', { name: 'Supervisión' }).click()
        await expect(page).toHaveURL(/\/sup$/)
        await expect(page.getByText(sedeSupervision.name)).toBeVisible()
        await expect(
          page.getByText(sedeEmpleado.name),
          'la vía de supervisor no mezcla sus servicios de empleado',
        ).toHaveCount(0)
      })

      await test.step('SUP-09 Más ofrece "Mis servicios" y vuelve a EMP-03', async () => {
        await page
          .getByRole('navigation', { name: 'Navegación principal' })
          .getByRole('link', { name: 'Más' })
          .click()
        await expect(page).toHaveURL(/\/sup\/mas$/)
        await page.getByRole('link', { name: 'Mis servicios' }).click()
        await expect(page).toHaveURL(/\/app$/)
        await expect(page.getByText(sedeEmpleado.name)).toBeVisible()
      })

      await test.step('las dos vías se pueden abrir directamente (sin redirecciones)', async () => {
        await page.goto('/sup/historial')
        await expect(page).toHaveURL(/\/sup\/historial$/)
        await page.goto('/app/mas')
        await expect(page).toHaveURL(/\/app\/mas$/)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)

test(
  'CB-13: supervisa un turno donde también trabaja: se ve "Vos", no puede calificarse y el servidor lo rechaza',
  cubre('CB-13', 'RB-S04', 'P-042'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('dual-cb13')
      const sede = await sc.site(cliente.id, 'dual-cb13')
      const turno = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS_MOVIL.diaCompleto,
        2,
      )
      const propia = await sc.assign(turno, 'dual')
      await sc.assign(turno, 'empleado1')
      const supervision = await sc.assignSupervision(turno, 'dual')
      await fijarConsentimiento('dual', true)
      await supervisionFichar('dual', supervision, 'inicio')
      await supervisionFichar('dual', supervision, 'fin')

      await test.step('SUP-03: su propia fila dice "Vos" y no ofrece calificar; la del compañero sí', async () => {
        await page.goto(`/sup/supervisiones/${supervision}`)
        const propiaFila = page
          .locator('div.flex.items-center.justify-between.gap-2')
          .filter({ hasText: 'E2E-Fijo Dual' })
        await expect(propiaFila.getByText('Vos')).toBeVisible()
        await expect(
          propiaFila.getByRole('link', { name: /Calificar|Editar/ }),
        ).toHaveCount(0)
        await expect(
          page
            .locator('div.flex.items-center.justify-between.gap-2')
            .filter({ hasText: 'E2E-Fijo Empleado1' })
            .getByRole('link', { name: 'Calificar' }),
        ).toBeVisible()
      })

      await test.step('SUP-06: el total a calificar excluye al propio supervisor', async () => {
        await page.getByRole('link', { name: 'Cerrar supervisión' }).click()
        await expect(page.getByText('Calificaste a 0 de 1')).toBeVisible()
      })

      await test.step('entrando por el enlace a calificarse, la pantalla lo impide', async () => {
        await page.goto(`/sup/supervisiones/${supervision}/calificar/${propia}`)
        await expect(
          page.getByText('No podés calificarte a vos mismo.'),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Guardar calificación' }),
        ).toHaveCount(0)
      })

      await test.step('por la API, el servidor lo rechaza (SELF_RATING_NOT_ALLOWED)', async () => {
        const api = await sessionClient('dual')
        expectHint(
          await api.rpc('rate_employee', {
            p_supervision_id: supervision,
            p_assignment_id: propia,
            p_score: 5,
          }),
          'SELF_RATING_NOT_ALLOWED',
        )
        const { data } = await sc.db
          .from('ratings')
          .select('id')
          .eq('supervision_id', supervision)
        expect(data).toHaveLength(0)
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
