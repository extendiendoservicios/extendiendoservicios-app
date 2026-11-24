import { expect, test, type Locator, type Page } from '@playwright/test'
import { daysFromToday } from '../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../fixtures/env.ts'
import { Scenario } from '../fixtures/scenario.ts'
import { readId, storageStatePath } from '../fixtures/sessions.ts'
import { cubre } from '../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../fixtures/ui.ts'

// P31.6 · D-09 (OI-07), SUP-10: coordinador › Más › «Próximos días»: los turnos de MAÑANA a hoy + 7,
// agrupados por día y, en cada día, «Mis sedes» (preferencia del coordinador) y «Otras sedes»; solo
// consulta (sin enlace al turno, sin «Supervisar», sin estado). No aparecen hoy, hoy + 8 ni los
// cancelados; «Hoy» queda solo con el día; la barra inferior sigue con 5 pestañas. 390 px.
// Cuentas: supervisor1 (coordinador), dual (empleado y coordinador) y empleado1 (sin acceso).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

const MESES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
]

/** Título de un día en la pantalla: «25 nov 2026» (`formatCalendarDate`). */
function etiquetaDe(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number)
  return `${d} ${MESES[m - 1]} ${y}`
}

const dia = (page: Page, fecha: string): Locator =>
  page.getByRole('region', { name: etiquetaDe(fecha), exact: true })

/** Cliente + sede + turno puntual de `fecha`, con la franja de la mañana. */
async function turno(
  sc: Scenario,
  slug: string,
  fecha: string,
  franja = { start: '08:00', end: '12:00' },
) {
  const cliente = await sc.client(slug)
  const sede = await sc.site(cliente.id, slug)
  const id = await sc.shift(cliente.id, sede.id, fecha, franja)
  return { cliente, sede, id }
}

test.describe('coordinador › Más › Próximos días (D-09)', () => {
  test.use({ storageState: storageStatePath('supervisor1') })

  test(
    'muestra los 7 días siguientes agrupados con Mis sedes / Otras sedes, sin hoy, sin hoy + 8, sin cancelados y sin acciones',
    cubre('RB-S01', 'RB-S03', 'OI-07', 'D-09', 'CJ-02', 'CJ-04'),
    async ({ page }) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const manana = daysFromToday(1)
        const en3 = daysFromToday(3)
        const en7 = daysFromToday(7)

        const mia = await turno(sc, 'd09-mia', manana)
        await sc.prioridad('supervisor1', { siteId: mia.sede.id })
        const otra = await turno(sc, 'd09-otra', manana, {
          start: '14:00',
          end: '18:00',
        })
        const otra3 = await turno(sc, 'd09-otra3', en3)
        const mia7 = await turno(sc, 'd09-mia7', en7)
        await sc.prioridad('supervisor1', { siteId: mia7.sede.id })
        // No tienen que aparecer: hoy, hoy + 8 y uno cancelado.
        const hoy = await turno(sc, 'd09-hoy', sc.today)
        const lejano = await turno(sc, 'd09-lejano', daysFromToday(8))
        const cancelado = await turno(sc, 'd09-canc', manana)
        const { error } = await sc.db
          .from('shifts')
          .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancelled_by: readId('admin'),
            cancel_reason: 'e2e-p31',
          })
          .eq('id', cancelado.id)
        expect(error, error?.message).toBeNull()
        // Con gente asignada se ve «N empleados» como en Hoy.
        await sc.assign(otra3.id, 'empleado2')

        await test.step('«Hoy» sigue con el día: no tiene los turnos de los próximos días', async () => {
          await page.goto('/sup')
          await expect(page.getByText(hoy.sede.name)).toBeVisible()
          await expect(page.getByText(otra.sede.name)).toHaveCount(0)
          // La barra inferior sigue con sus cinco pestañas (no se agregó ninguna).
          await expect(
            page
              .getByRole('navigation', { name: 'Navegación principal' })
              .getByRole('link'),
          ).toHaveCount(5)
        })

        await test.step('Más › «Próximos días» es la primera opción y lleva a /sup/proximos', async () => {
          await page
            .getByRole('navigation', { name: 'Navegación principal' })
            .getByRole('link', { name: 'Más' })
            .click()
          const primera = page.getByRole('link', { name: 'Próximos días' })
          await expect(primera).toBeVisible()
          await primera.click()
          await expect(page).toHaveURL(/\/sup\/proximos$/)
        })

        await test.step('un bloque por día, ordenado, con Mis sedes y Otras sedes', async () => {
          await expect(dia(page, manana)).toBeVisible()
          const dentroDeManana = dia(page, manana)
          await expect(
            dentroDeManana
              .getByRole('region', { name: 'Mis sedes' })
              .getByText(mia.sede.name),
          ).toBeVisible()
          await expect(
            dentroDeManana
              .getByRole('region', { name: 'Otras sedes' })
              .getByText(otra.sede.name),
          ).toBeVisible()
          await expect(
            dia(page, en3)
              .getByRole('region', { name: 'Otras sedes' })
              .getByText(otra3.sede.name),
          ).toBeVisible()
          await expect(
            dia(page, en3).getByRole('region', { name: 'Otras sedes' }),
          ).toContainText('1 empleado')
          await expect(
            dia(page, en7)
              .getByRole('region', { name: 'Mis sedes' })
              .getByText(mia7.sede.name),
          ).toBeVisible()
          // Los días vienen en orden cronológico.
          const titulos = await page
            .getByRole('heading', { level: 2 })
            .allInnerTexts()
          const esperados = [manana, en3, en7].map(etiquetaDe)
          const presentes = titulos.filter((t) => esperados.includes(t))
          expect(presentes).toEqual(esperados)
        })

        await test.step('hoy, hoy + 8 y los cancelados no están', async () => {
          for (const fuera of [
            hoy.sede.name,
            lejano.sede.name,
            cancelado.sede.name,
          ]) {
            await expect(page.getByText(fuera)).toHaveCount(0)
          }
        })

        await test.step('solo consulta: sin enlaces a turnos, sin «Supervisar» y sin estado', async () => {
          await expect(page.locator('a[href^="/sup/turnos/"]')).toHaveCount(0)
          await expect(
            page.getByRole('button', { name: /Supervisar/ }),
          ).toHaveCount(0)
          await expect(page.getByTestId('upcoming-shift').first()).toBeVisible()
          await expect(
            page
              .getByTestId('upcoming-shift')
              .filter({ hasText: 'Programado' }),
          ).toHaveCount(0)
        })

        await test.step('el buscador filtra «Otras sedes» de todos los días y deja «Mis sedes»', async () => {
          await page
            .getByRole('searchbox', { name: 'Buscar por cliente o sede' })
            .fill(otra3.sede.name)
          await expect(page.getByText(otra3.sede.name)).toBeVisible()
          await expect(page.getByText(otra.sede.name)).toHaveCount(0)
          await expect(page.getByText(mia.sede.name)).toBeVisible()
          await page
            .getByRole('searchbox', { name: 'Buscar por cliente o sede' })
            .fill('e2e-no-existe-xyz')
          await expect(
            page.getByText('No encontramos turnos con esa búsqueda.').first(),
          ).toBeVisible()
        })

        await expectNoHorizontalScroll(page)
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('doble rol y empleado en Próximos días (D-09)', () => {
  test.describe('doble rol', () => {
    test.use({ storageState: storageStatePath('dual') })

    test(
      'quien además es empleado ve arriba «Tus servicios» de los próximos días',
      cubre('RB-S01', 'OI-07', 'D-09', 'CJ-02'),
      async ({ page }) => {
        test.setTimeout(240_000)
        const sc = new Scenario()
        try {
          const manana = daysFromToday(2)
          const propio = await turno(sc, 'd09-propio', manana)
          await sc.assign(propio.id, 'dual')
          const ajeno = await turno(sc, 'd09-ajeno', manana, {
            start: '14:00',
            end: '18:00',
          })

          await page.goto('/sup/proximos')
          const tuyos = page.getByRole('region', {
            name: 'Tus servicios de los próximos días',
          })
          await expect(tuyos).toContainText(propio.sede.name)
          await expect(tuyos).not.toContainText(ajeno.sede.name)
          // El turno propio también está en la lista general del día, igual que el ajeno.
          await expect(dia(page, manana)).toContainText(ajeno.sede.name)
          await expectNoHorizontalScroll(page)
        } finally {
          expect(await sc.cleanup(), 'limpieza').toEqual([])
        }
      },
    )
  })

  test.describe('solo empleado', () => {
    test.use({ storageState: storageStatePath('empleado1') })

    test(
      'quien no es coordinador no entra a /sup/proximos',
      cubre('RB-X02', 'OI-07', 'D-09', 'CB-17'),
      async ({ page }) => {
        await page.goto('/sup/proximos')
        await expect(page).not.toHaveURL(/\/sup\/proximos/)
        await expect(
          page.getByText('Los turnos de los próximos 7 días'),
        ).toHaveCount(0)
      },
    )
  })
})
