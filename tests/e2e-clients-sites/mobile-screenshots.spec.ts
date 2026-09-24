import { expect, test } from '@playwright/test'
import { readE2eClientsSitesEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  createDisposableClient,
  createDisposableSite,
  deleteDisposableClient,
  disposableName,
  getAdminClient,
} from './helpers/adminClient.ts'
import { interceptMapRequests } from './helpers/interceptMap.ts'
import { loginAs } from './helpers/login.ts'
import { expectNoHorizontalScroll } from './helpers/noHorizontalScroll.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// TEST-005: capturas móviles (390 px, proyecto `mobile` de `playwright.clients-sites.config.ts`)
// de ADM-19 (listado), ADM-21, ADM-22 y ADM-24, comprobando en cada una que no haya scroll
// horizontal (`scrollWidth <= clientWidth`). Las capturas quedan en `test-results/`, la misma
// carpeta donde Playwright ya guarda el resto de la evidencia de una corrida (`.gitignore`: no
// se versionan, son artefactos de cada corrida, no documentación).

const env = readE2eClientsSitesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('TEST-005: capturas móviles sin scroll horizontal', () => {
  test('ADM-19, ADM-21, ADM-22 y ADM-24 a 390 px, sin scroll horizontal', async ({
    page,
  }) => {
    const admin = getAdminClient()
    const legalName = disposableName('Cliente Capturas Móviles')
    const client = await createDisposableClient(admin, { legalName })

    const site = await createDisposableSite(admin, client.id, {
      name: disposableName('Sede Capturas Móviles'),
      address: 'Dirección de prueba para la captura',
    })
    const siteId = site.id

    try {
      await interceptMapRequests(page)
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      await test.step('ADM-19 · Clientes · listado', async () => {
        await page.goto('/admin/clientes')
        await expect(page.getByText(legalName)).toBeVisible()
        await expectNoHorizontalScroll(page)
        await page.screenshot({
          path: 'test-results/capturas-p085/ADM-19-listado-390.png',
          fullPage: true,
        })
      })

      await test.step('ADM-21 · Cliente · detalle', async () => {
        await page.goto(`/admin/clientes/${client.id}`)
        await expect(
          page.getByRole('heading', { name: legalName }),
        ).toBeVisible()
        await expectNoHorizontalScroll(page)
        await page.screenshot({
          path: 'test-results/capturas-p085/ADM-21-detalle-cliente-390.png',
          fullPage: true,
        })
      })

      await test.step('ADM-22 · Sede · detalle', async () => {
        await page.goto(`/admin/sedes/${siteId}`)
        await expect(
          page.getByRole('heading', { level: 3, name: 'Datos' }),
        ).toBeVisible()
        // Espera al marcador de la sección "Ubicación" antes de la captura (mismo motivo que
        // ADM-24 más abajo: sin esto, la captura podía agarrar el mapa todavía sin dibujar).
        await expect(
          page.getByRole('button', { name: site.name }),
        ).toBeVisible()
        await expectNoHorizontalScroll(page)
        await page.screenshot({
          path: 'test-results/capturas-p085/ADM-22-detalle-sede-390.png',
          fullPage: true,
        })
      })

      await test.step('ADM-24 · Mapa de clientes y sedes', async () => {
        await page.goto('/admin/clientes?pestana=mapa')
        await page
          .getByRole('combobox', { name: 'Filtrar por cliente' })
          .click()
        await page.getByRole('option', { name: legalName }).click()
        // Espera a que el desplegable termine de cerrarse y a que el marcador de la sede esté
        // dibujado antes de la captura: sin esto, la captura podía llegar a agarrar un instante
        // intermedio (el desplegable todavía cerrándose, o `useSitesMapQuery` todavía en curso,
        // con el estado vacío "Sin sedes con ubicación para mostrar" de por medio) — encontrado
        // en la primera corrida de este spec.
        await expect(page.getByRole('listbox')).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: `${legalName} — ${site.name}` }),
        ).toBeVisible()
        await expectNoHorizontalScroll(page)
        await page.screenshot({
          path: 'test-results/capturas-p085/ADM-24-mapa-390.png',
          fullPage: true,
        })
      })
    } finally {
      await deleteDisposableClient(admin, client.id)
    }
  })
})
