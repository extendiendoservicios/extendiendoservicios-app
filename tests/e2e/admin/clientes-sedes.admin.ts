import { expect, test } from '@playwright/test'
import { FRANJAS } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario, sessionClient } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { interceptMapRequests } from '../../fixtures/ui.ts'

// TEST-016 (P18.1): clientes y sedes desde la administración (RB-A03).
//   - CB-19 (P-024): cliente suspendido con turnos futuros ya generados: los turnos quedan, no se
//     generan nuevos y ADM-19 lo indica.
//   - CB-20 (P-028): sede sin coordenadas: no aparece en el mapa, la ficha lo indica y el
//     empleado ve la dirección igual.
// El alta de cliente, de contactos y de sedes con coordenadas ya la recorre
// `tests/e2e-clients-sites/` (CLIENT-008, SITE-008); acá van los casos borde.
// Mes lejano reservado de este archivo: junio de 2193. Empleado: empleado2, de 08:00 a 12:00 (cada
// archivo usa su propia combinación de empleado y franja para correr en paralelo sin superponerse).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.describe('clientes y sedes (ADM-19 a ADM-24)', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'CB-19: un cliente suspendido conserva sus turnos ya generados, no recibe turnos nuevos y el listado lo indica',
    cubre('RB-A03', 'RB-A04', 'CB-19', 'P-024'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      sc.useFarMonth(2193, 6)
      try {
        const client = await sc.client('suspende')
        const site = await sc.site(client.id, 'suspende')
        await sc.service(client.id, site.id, 'diario', {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          validFrom: '2193-06-01',
          validTo: '2193-06-30',
        })
        const owner = await sessionClient('owner')
        const contar = async () => {
          const { count } = await sc.db
            .from('shifts')
            .select('id', { count: 'exact', head: true })
            .eq('client_id', client.id)
          return count ?? 0
        }

        await test.step('con el cliente activo, la generación crea los 30 turnos de junio', async () => {
          const generado = await owner.rpc('generate_shifts', {
            p_year: 2193,
            p_month: 6,
          })
          expect(generado.error, generado.error?.message).toBeNull()
          expect(await contar()).toBe(30)
        })

        await test.step('el administrador suspende al cliente desde ADM-21', async () => {
          await page.goto(`/admin/clientes/${client.id}`)
          await page.getByRole('button', { name: 'Cambiar estado' }).click()
          await page.getByRole('combobox', { name: 'Estado nuevo' }).click()
          await page.getByRole('option', { name: 'Suspendido' }).click()
          await page
            .getByRole('button', { name: 'Cambiar estado' })
            .last()
            .click()
          await expect(
            page.getByText('Cambiamos el estado del cliente.'),
          ).toBeVisible()
        })

        await test.step('un servicio nuevo del cliente suspendido no genera turnos; los ya generados quedan', async () => {
          await sc.service(client.id, site.id, 'nuevo-servicio', {
            weekdays: [1, 2, 3],
            start: '14:00',
            end: '18:00',
            validFrom: '2193-06-01',
            validTo: '2193-06-30',
          })
          const regenerado = await owner.rpc('generate_shifts', {
            p_year: 2193,
            p_month: 6,
          })
          expect(regenerado.error, regenerado.error?.message).toBeNull()
          expect(
            await contar(),
            'no se crearon turnos nuevos ni se borraron los existentes',
          ).toBe(30)
          const { data: estados } = await sc.db
            .from('shifts')
            .select('status')
            .eq('client_id', client.id)
          expect(estados?.every((s) => s.status === 'scheduled')).toBe(true)
        })

        await test.step('ADM-19 y ADM-21 indican que el cliente está suspendido', async () => {
          await page.goto('/admin/clientes')
          // Por omisión el listado muestra solo los activos: el suspendido se ve al filtrar.
          await page
            .getByRole('combobox', { name: 'Filtrar por estado' })
            .click()
          await page.getByRole('option', { name: 'Suspendido' }).click()
          await page.getByPlaceholder(/Buscar/).fill(client.name)
          const fila = page.getByRole('row').filter({ hasText: client.name })
          await expect(fila).toContainText('Suspendido')
          await page.goto(`/admin/clientes/${client.id}`)
          await expect(
            page.getByText('Suspendido', { exact: true }),
          ).toBeVisible()
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'CB-20: una sede sin coordenadas no aparece en el mapa, la ficha lo indica y el empleado ve la dirección igual',
    cubre('RB-A03', 'RB-E03', 'CB-20', 'P-028'),
    async ({ page, browser }) => {
      const sc = new Scenario()
      try {
        const client = await sc.client('sinmapa')
        const sinCoords = await sc.site(client.id, 'sin-coordenadas')
        const conCoords = await sc.site(client.id, 'con-coordenadas', {
          lat: -34.6037,
          lng: -58.3816,
        })
        const shiftId = await sc.shift(
          client.id,
          sinCoords.id,
          sc.today,
          FRANJAS.manana,
        )
        await sc.assign(shiftId, 'empleado2')
        const { data: fila } = await sc.db
          .from('sites')
          .select('id')
          .eq('name', sinCoords.name)
          .single()

        await interceptMapRequests(page)

        await test.step('ADM-24: el mapa muestra solo la sede con coordenadas y avisa de la otra', async () => {
          await page.goto('/admin/clientes?pestana=mapa')
          await page
            .getByRole('combobox', { name: 'Filtrar por cliente' })
            .click()
          await page.getByRole('option', { name: client.name }).click()
          await expect(
            page.getByText(
              'Hay 1 sede sin ubicación cargada, no se ve en el mapa.',
            ),
          ).toBeVisible()
          await expect(
            page.getByRole('button', {
              name: `${client.name} — ${conCoords.name}`,
            }),
          ).toBeVisible()
          await expect(
            page.getByRole('button', {
              name: `${client.name} — ${sinCoords.name}`,
            }),
          ).toHaveCount(0)
        })

        await test.step('ADM-22: la ficha de la sede indica que no hay coordenadas', async () => {
          await page.goto(`/admin/sedes/${fila!.id}`)
          await expect(
            page.getByRole('heading', { name: sinCoords.name }),
          ).toBeVisible()
          await expect(
            page.getByText('Todavía no hay coordenadas cargadas.'),
          ).toBeVisible()
        })

        await test.step('EMP-04: el empleado asignado ve la dirección igual', async () => {
          const ctx = await browser.newContext({
            storageState: storageStatePath('empleado2'),
          })
          const empleado = await ctx.newPage()
          try {
            await empleado.goto('/app')
            await empleado
              .getByRole('link')
              .filter({ hasText: sinCoords.name })
              .click()
            await expect(empleado).toHaveURL(/\/app\/servicio\//)
            await expect(empleado.getByRole('main')).toContainText(
              'Dirección de prueba 123',
            )
          } finally {
            await ctx.close()
          }
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})
