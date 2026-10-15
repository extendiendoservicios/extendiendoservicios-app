import { expect, test, type Page } from '@playwright/test'
import { getAdminDb } from '../fixtures/accounts.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { desplazar, SEDE_COORDS, sedeGeo } from './helpers/geo.ts'

// P22.5 · Radios de validación (B-02, B-16, B-17): «Mostrar radios» y el radio general en el mapa
// de Clientes (ADM-24), el radio propio en el formulario de la sede (ADM-22) y en su detalle.
// Los radios de los círculos se leen del trazo del mapa (el radio del arco en píxeles es
// proporcional al radio en metros). El radio general es un dato único de la empresa: el test que
// lo cambia lo repone en el `finally` y borra el rastro que dejó en `security_events`.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

/** Radio del arco (px) de cada trazo del mapa, en el orden en que están en el DOM. */
async function radiosDeLosCirculos(page: Page): Promise<number[]> {
  return page.locator('.leaflet-overlay-pane path').evaluateAll((trazos) =>
    trazos.map((t) => {
      const d = t.getAttribute('d') ?? ''
      const m = /a([\d.]+),[\d.]+ 0 1,0/.exec(d)
      return m ? Number(m[1]) : 0
    }),
  )
}

async function elegirCliente(page: Page, nombre: string) {
  await page.getByRole('combobox', { name: 'Filtrar por cliente' }).click()
  await page.getByRole('option', { name: nombre }).click()
}

async function radioGeneralGuardado(): Promise<number> {
  const { data } = await getAdminDb()
    .from('company_settings')
    .select('geofence_radius_m')
    .eq('id', 1)
    .single()
  return data!.geofence_radius_m
}

test.describe('administrador con todas las capacidades', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'ADM-24: «Mostrar radios» dibuja un círculo por sede con su radio vigente, el cliente no lleva círculo y las sedes sin ubicación se avisan',
    cubre('RB-A02', 'RB-A03', 'B-02', 'B-14', 'B-16', 'B-17', 'CB-20'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const general = await radioGeneralGuardado()
        const cliente = await sc.client('geo-radios')
        const propia = await sedeGeo(sc, cliente, 'geo-radios-propia', {
          radio: 250,
        })
        const usaGeneral = await sedeGeo(sc, cliente, 'geo-radios-general', {
          coords: desplazar(SEDE_COORDS, 0, 1500),
          radio: null,
        })
        await sedeGeo(sc, cliente, 'geo-radios-sin-coords', {
          coords: null,
          radio: null,
        })

        await page.goto('/admin/clientes?pestana=mapa')
        await elegirCliente(page, cliente.name)
        await expect(
          page.getByText(
            'Hay 1 sede sin ubicación cargada, no se ve en el mapa.',
          ),
        ).toBeVisible()
        await expect(
          page.locator(`[title="${cliente.name} — ${propia.name}"]`),
        ).toBeVisible()

        await test.step('con el interruptor apagado no hay círculos (B-16)', async () => {
          const interruptor = page.getByRole('switch', {
            name: 'Mostrar radios',
          })
          await expect(interruptor).not.toBeChecked()
          await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(
            0,
          )
        })

        await test.step('encendido: un círculo por sede con coordenadas, proporcional a su radio vigente (B-02, B-14)', async () => {
          await page.getByRole('switch', { name: 'Mostrar radios' }).click()
          await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(
            2,
          )
          // El orden de los trazos es el del listado: se compara el mayor con el menor.
          const [chico, grande] = (await radiosDeLosCirculos(page)).sort(
            (a, b) => a - b,
          )
          const esperada = Math.max(250, general) / Math.min(250, general)
          expect(grande / chico).toBeGreaterThan(esperada * 0.9)
          expect(grande / chico).toBeLessThan(esperada * 1.1)
          await page.getByRole('switch', { name: 'Mostrar radios' }).click()
          await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(
            0,
          )
        })

        await test.step('el popup de cada sede dice si el radio es propio o general (B-02)', async () => {
          await page
            .locator(`[title="${cliente.name} — ${propia.name}"]`)
            .click()
          await expect(
            page
              .locator('.leaflet-popup-content')
              .getByText('Radio de validación: 250 m (propio)'),
          ).toBeVisible()
          await page.keyboard.press('Escape')
          await page
            .locator(`[title="${cliente.name} — ${usaGeneral.name}"]`)
            .click()
          await expect(
            page
              .locator('.leaflet-popup-content')
              .getByText(`Radio de validación: ${general} m (general)`),
          ).toBeVisible()
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'ADM-24: el radio general se edita junto al mapa (50 a 1000 m), queda guardado, registrado y no recalcula fichajes anteriores',
    cubre('RB-A02', 'RB-A03', 'B-02', 'B-08', 'B-16'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      const db = getAdminDb()
      const original = await radioGeneralGuardado()
      const desde = new Date().toISOString()
      try {
        const nuevo = original === 777 ? 778 : 777
        const cliente = await sc.client('geo-radio-general')
        const sede = await sedeGeo(sc, cliente, 'geo-radio-general', {
          radio: null,
        })

        await page.goto('/admin/clientes?pestana=mapa')
        await elegirCliente(page, cliente.name)
        const campo = page.getByLabel('Radio general (m)')
        await expect(campo).toHaveValue(String(original))
        await expect(
          page.getByRole('button', { name: 'Guardar', exact: true }),
        ).toHaveCount(0)

        await test.step('un valor fuera de 50 a 1000 no se puede guardar', async () => {
          for (const invalido of ['49', '1001', '0']) {
            await campo.fill(invalido)
            await expect(
              page.getByText(
                'El radio tiene que ser un número entero entre 50 y 1000 metros.',
              ),
            ).toBeVisible()
            await expect(
              page.getByRole('button', { name: 'Guardar', exact: true }),
            ).toBeDisabled()
          }
          expect(await radioGeneralGuardado(), 'no cambió nada').toBe(original)
        })

        await test.step('un valor válido se guarda con el botón «Guardar» y queda el cambio registrado', async () => {
          await campo.fill(String(nuevo))
          await page
            .getByRole('button', { name: 'Guardar', exact: true })
            .click()
          await expect(
            page.getByText('Guardamos el radio general.'),
          ).toBeVisible()
          expect(await radioGeneralGuardado()).toBe(nuevo)
          await expect(
            page.getByRole('button', { name: 'Guardar', exact: true }),
          ).toHaveCount(0)
          const { data: eventos } = await db
            .from('security_events')
            .select('details')
            .eq('event_type', 'geofence_radius_changed')
            .gte('created_at', desde)
          const delRadio = (eventos ?? []).find(
            (e) =>
              (e.details as { scope?: string; new?: number }).scope ===
              'company',
          )
          expect(
            delRadio,
            'el cambio de radio general queda en security_events',
          ).toBeDefined()
          expect((delRadio!.details as { new: number; old: number }).new).toBe(
            nuevo,
          )
          expect((delRadio!.details as { new: number; old: number }).old).toBe(
            original,
          )
        })

        await test.step('las sedes sin radio propio pasan a usar el nuevo valor; los fichajes anteriores no se recalculan (B-08)', async () => {
          await page.reload()
          await elegirCliente(page, cliente.name)
          await page.locator(`[title="${cliente.name} — ${sede.name}"]`).click()
          await expect(
            page
              .locator('.leaflet-popup-content')
              .getByText(`Radio de validación: ${nuevo} m (general)`),
          ).toBeVisible()
          const { data: viejos } = await db
            .from('attendance_records')
            .select('geofence_radius_m')
            .not('geofence_radius_m', 'is', null)
            .neq('geofence_radius_m', nuevo)
            .limit(1)
          expect(
            viejos?.length ?? 0,
            'los fichajes anteriores conservan su radio',
          ).toBeGreaterThan(0)
        })
      } finally {
        // El radio general es un dato único de la empresa: se repone y se borra el rastro propio.
        await db
          .from('company_settings')
          .update({ geofence_radius_m: original })
          .eq('id', 1)
        await db
          .from('security_events')
          .delete()
          .eq('event_type', 'geofence_radius_changed')
          .gte('created_at', desde)
        expect(await radioGeneralGuardado(), 'radio general repuesto').toBe(
          original,
        )
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'ADM-22 y ADM-23: el radio propio se carga en el formulario de la sede (50 a 1000 m), se muestra en el detalle y vacío vuelve al general',
    cubre('RB-A02', 'RB-A03', 'B-02', 'B-16'),
    async ({ page }) => {
      test.setTimeout(180_000)
      const sc = new Scenario()
      try {
        const general = await radioGeneralGuardado()
        const cliente = await sc.client('geo-sede-form')
        const sede = await sedeGeo(sc, cliente, 'geo-sede-form', {
          radio: null,
        })
        const leer = async () => {
          const { data } = await sc.db
            .from('sites')
            .select('geofence_radius_m')
            .eq('id', sede.id)
            .single()
          return data!.geofence_radius_m
        }

        await page.goto(`/admin/sedes/${sede.id}/editar`)
        const campo = page.getByLabel('Radio de validación propio (opcional)')
        await expect(campo).toHaveValue('')
        await expect(campo).toHaveAttribute('placeholder', String(general))
        await expect(
          page.getByText(
            `Si lo dejás vacío se usa el radio general (${general} m).`,
          ),
        ).toBeVisible()

        await test.step('fuera de 50 a 1000 se rechaza y no se guarda', async () => {
          for (const invalido of ['49', '1001']) {
            await campo.fill(invalido)
            await page.getByRole('button', { name: 'Guardar cambios' }).click()
            await expect(
              page.getByText(
                'El radio tiene que ser un número entero entre 50 y 1000 metros.',
              ),
            ).toBeVisible()
            expect(await leer()).toBeNull()
          }
        })

        await test.step('un valor válido se guarda y el detalle de la sede lo muestra como «propio»', async () => {
          await campo.fill('320')
          await page.getByRole('button', { name: 'Guardar cambios' }).click()
          await expect.poll(leer).toBe(320)
          await page.goto(`/admin/sedes/${sede.id}`)
          await expect(
            page.getByText('Radio de validación: 320 m (propio)'),
          ).toBeVisible()
        })

        await test.step('«Mostrar radios» en el detalle de la sede (B-16)', async () => {
          await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(
            0,
          )
          await page.getByRole('switch', { name: 'Mostrar radios' }).click()
          await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(
            1,
          )
          await page.getByRole('switch', { name: 'Mostrar radios' }).click()
          await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(
            0,
          )
        })

        await test.step('vaciar el campo deja la sede con el radio general', async () => {
          await page.goto(`/admin/sedes/${sede.id}/editar`)
          await expect(campo).toHaveValue('320')
          await campo.fill('')
          await page.getByRole('button', { name: 'Guardar cambios' }).click()
          await expect.poll(leer).toBeNull()
          await page.goto(`/admin/sedes/${sede.id}`)
          await expect(
            page.getByText(`Radio de validación: ${general} m (general)`),
          ).toBeVisible()
        })
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )

  test(
    'ADM-23: una sede sin coordenadas no ofrece «Mostrar radios»',
    cubre('RB-A02', 'B-16', 'CB-20'),
    async ({ page }) => {
      test.setTimeout(120_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('geo-sede-sin-coords')
        const sede = await sedeGeo(sc, cliente, 'geo-sede-sin-coords', {
          coords: null,
          radio: null,
        })
        await page.goto(`/admin/sedes/${sede.id}`)
        await expect(
          page.getByRole('heading', { name: 'Ubicación' }),
        ).toBeVisible()
        await expect(
          page.getByRole('switch', { name: 'Mostrar radios' }),
        ).toHaveCount(0)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('administrador sin capacidades', () => {
  test.use({ storageState: storageStatePath('adminSinCapacidades') })

  test(
    'ADM-24: el radio general lo edita cualquier administrador (B-02): el campo está disponible y valida sin guardar',
    cubre('RB-A02', 'RB-X02', 'B-02'),
    async ({ page }) => {
      test.setTimeout(120_000)
      const original = await radioGeneralGuardado()
      await page.goto('/admin/clientes?pestana=mapa')
      const campo = page.getByLabel('Radio general (m)')
      await expect(campo).toBeVisible()
      await expect(campo).toHaveValue(String(original))
      await campo.fill(String(original + 1))
      await expect(
        page.getByRole('button', { name: 'Guardar', exact: true }),
      ).toBeEnabled()
      await campo.fill(String(original))
      await expect(
        page.getByRole('button', { name: 'Guardar', exact: true }),
      ).toHaveCount(0)
      expect(await radioGeneralGuardado()).toBe(original)
    },
  )
})
