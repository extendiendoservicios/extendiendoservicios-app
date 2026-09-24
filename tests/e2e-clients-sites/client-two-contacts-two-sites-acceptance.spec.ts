import { expect, test } from '@playwright/test'
import { readE2eClientsSitesEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  deleteDisposableClient,
  disposableCuit,
  disposableName,
  getAdminClient,
} from './helpers/adminClient.ts'
import { interceptMapRequests } from './helpers/interceptMap.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// Criterio de aceptación de F8 (08_Fases_y_Backlog.md, literal): "Un administrador da de alta un
// cliente con dos contactos y dos sedes con coordenadas; el mapa las muestra." A diferencia de
// CLIENT-008 y SITE-008 (que corren como el dueño, igual que el resto de esta suite), este test
// corre específicamente con la cuenta `admin` del seed (no `owner`) — el encargo P08.5 lo pide
// así a propósito, porque `04_Modelo_de_Datos.md` sección 7.2 dice "O, A: todas" para este
// dominio y el criterio de la fase no distingue de cuál de los dos: conviene probarlo con el que
// no se prueba en el resto de la suite.

const env = readE2eClientsSitesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('Criterio de aceptación de F8: administrador, dos contactos, dos sedes en el mapa', () => {
  test('un administrador da de alta un cliente con dos contactos y dos sedes con coordenadas; el mapa las muestra', async ({
    page,
  }) => {
    const admin = getAdminClient()
    const legalName = disposableName('Cliente Criterio F8')
    const cuit = disposableCuit()
    let clientId: string | null = null

    try {
      await interceptMapRequests(page)
      await loginAs(page, SEED_ACCOUNTS.admin, env!.seedPassword, /\/admin$/)

      await test.step('alta del cliente', async () => {
        await page.goto('/admin/clientes/nuevo')
        await page.getByLabel('Razón social').fill(legalName)
        await page.getByLabel('CUIT').fill(cuit)
        await page.getByRole('button', { name: 'Crear cliente' }).click()
        await expect(page.getByText('Creamos el cliente.')).toBeVisible()
        const match = page.url().match(/\/admin\/clientes\/([0-9a-f-]+)$/)
        clientId = match?.[1] ?? null
        expect(
          clientId,
          'no pudimos leer el id del cliente recién creado',
        ).toBeTruthy()
      })

      await test.step('dos contactos', async () => {
        await page.getByRole('tab', { name: 'Contactos' }).click()
        for (const name of ['Contacto Uno F8', 'Contacto Dos F8']) {
          await page.getByRole('button', { name: 'Nuevo contacto' }).click()
          await page.getByLabel('Nombre').fill(name)
          await page.getByRole('button', { name: 'Guardar' }).click()
          await expect(page.getByText('Agregamos el contacto.')).toBeVisible()
        }
        await expect(page.getByText('Contacto Uno F8')).toBeVisible()
        await expect(page.getByText('Contacto Dos F8')).toBeVisible()
      })

      const siteNames = [
        disposableName('Sede F8 Uno'),
        disposableName('Sede F8 Dos'),
      ]
      const coordinates: Array<[string, string]> = [
        ['-34.6037', '-58.3816'], // Obelisco
        ['-34.5875', '-58.4021'], // Palermo, un punto distinto para no superponer marcadores
      ]

      await test.step('dos sedes, cada una con coordenadas', async () => {
        for (let i = 0; i < siteNames.length; i += 1) {
          await page.goto(`/admin/sedes/nueva?cliente=${clientId}`)
          await page.getByLabel('Nombre').fill(siteNames[i])
          await page
            .getByLabel('Dirección', { exact: true })
            .fill(`Dirección de prueba ${i + 1}`)
          await page.getByLabel('Latitud').fill(coordinates[i][0])
          await page.getByLabel('Longitud').fill(coordinates[i][1])
          await page.getByRole('button', { name: 'Crear sede' }).click()
          await expect(page.getByText('Creamos la sede.')).toBeVisible()
          await expect(page).toHaveURL(/\/admin\/sedes\/[0-9a-f-]+$/)
        }
      })

      await test.step('el mapa muestra las dos sedes, filtrado por este cliente', async () => {
        await page.goto('/admin/clientes?pestana=mapa')
        await page
          .getByRole('combobox', { name: 'Filtrar por cliente' })
          .click()
        await page.getByRole('option', { name: legalName }).click()

        for (const siteName of siteNames) {
          await expect(
            page.getByRole('button', { name: `${legalName} — ${siteName}` }),
          ).toBeVisible()
        }
      })
    } finally {
      if (clientId) {
        await deleteDisposableClient(admin, clientId)
      }
    }
  })
})
