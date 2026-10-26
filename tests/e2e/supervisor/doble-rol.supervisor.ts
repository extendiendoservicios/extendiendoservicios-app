import { expect, test } from '@playwright/test'
import { nombreDe } from '../../fixtures/accounts.ts'
import { expectHint } from '../../fixtures/api.ts'
import {
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import {
  calificar,
  fichar,
  FRANJAS_MOVIL,
  fijarConsentimiento,
  marcarCambiosVistos,
  tarjetaDeTurno,
} from '../../fixtures/movil.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { irARedirigida } from '../../fixtures/ui.ts'

// TEST-018 (P18.2): el doble rol empleado y supervisor (`e2e-fijo-dual`): el ingreso va a la vía
// de empleado, "Más" ofrece "Supervisión" (EMP-13) y "Mis servicios" (SUP-09) con los enlaces
// reales, cada vía muestra lo suyo (la de supervisión, desde P19.9, suma «Tus servicios de hoy»), y CB-13 (supervisor que también trabaja como empleado
// del turno: se ve "Vos", no puede calificarse, el servidor lo rechaza con
// `SELF_RATING_NOT_ALLOWED` y queda fuera del requisito de calificar, CJ-28). RB-E01, RB-S01, RB-S04,
// P-042, P-122. P24.5: sin asignación previa, el coordinador ve el turno de hoy y lo toma él.
// Cuentas: dual; empleado1 es el compañero del turno.

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
      await marcarCambiosVistos('dual')

      await test.step('al entrar, el inicio es el de empleado (COM-01): Hoy con su servicio, sin la supervisión', async () => {
        await irARedirigida(page, '/')
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
        // P19.9: quien también es empleado ve su servicio aparte, en «Tus servicios de hoy»
        // (enlace a /app/servicio), sin mezclarlo con las supervisiones a su cargo.
        const propios = page.getByRole('region', {
          name: 'Tus servicios de hoy',
        })
        await expect(propios.getByText(sedeEmpleado.name)).toBeVisible()
        await expect(
          propios.getByText(sedeSupervision.name),
          'sus servicios de empleado no incluyen el turno que supervisa',
        ).toHaveCount(0)
        await expect(
          tarjetaDeTurno(page, sedeSupervision.name),
        ).toHaveAttribute('href', /\/sup\/turnos\//)
        await expect(
          page
            .locator('a[href^="/app/servicio/"]')
            .filter({ hasText: sedeEmpleado.name }),
          'el servicio de empleado lleva a la vía de empleado, no a una supervisión',
        ).toBeVisible()
        // CJ-02: su propio turno también figura entre los que puede supervisar (con aviso al tomarlo).
        await expect(tarjetaDeTurno(page, sedeEmpleado.name)).toHaveAttribute(
          'href',
          /\/sup\/turnos\//,
        )
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
  cubre('CB-13', 'RB-S04', 'P-042', 'CJ-28'),
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
      const delCompanero = await sc.assign(turno, 'empleado1')
      await fijarConsentimiento('dual', true)
      await fijarConsentimiento('empleado1', true)
      await fichar('empleado1', delCompanero, 'inicio')
      const supervision = await sc.tomarSupervision(turno, 'dual')

      await test.step('SUP-04: su propia fila dice "Vos" y no ofrece calificar; la del compañero sí', async () => {
        await page.goto(`/sup/supervisiones/${supervision}`)
        const propiaFila = page
          .locator('div.flex.items-center.justify-between.gap-2')
          .filter({ hasText: nombreDe('dual') })
        await expect(propiaFila.getByText('Vos')).toBeVisible()
        await expect(
          propiaFila.getByRole('link', { name: /Calificar|Editar/ }),
        ).toHaveCount(0)
        await expect(
          page
            .locator('div.flex.items-center.justify-between.gap-2')
            .filter({ hasText: nombreDe('empleado1') })
            .getByRole('link', { name: 'Calificar' }),
        ).toBeVisible()
      })

      await test.step('CJ-28, SUP-06: el total a calificar excluye al propio coordinador y el cierre queda bloqueado solo por el compañero', async () => {
        await page.goto(`/sup/supervisiones/${supervision}/cerrar`)
        await expect(page.getByText('Calificaste a 0 de 1')).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Cerrar supervisión' }),
        ).toBeDisabled()
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

      await test.step('CJ-28: al calificar al compañero se puede cerrar sin calificarse a sí mismo', async () => {
        await calificar('dual', supervision, delCompanero, 4)
        await page.goto(`/sup/supervisiones/${supervision}/cerrar`)
        await expect(page.getByText('Calificaste a 1 de 1')).toBeVisible()
        await page.getByRole('button', { name: 'Cerrar supervisión' }).click()
        await expect(page).toHaveURL(/\/sup$/)
        const { data } = await sc.db
          .from('supervisions')
          .select('status')
          .eq('id', supervision)
          .single()
        expect(data?.status).toBe('completed')
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
