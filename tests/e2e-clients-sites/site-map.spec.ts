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
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

// SITE-008 (08_Fases_y_Backlog.md F8, SITE-005 "e2e: crear sede con coordenadas y verla en el
// mapa"): un administrador crea una sede con coordenadas desde ADM-23 y la ve en ADM-24 (pestaña
// Mapa de ADM-19), filtra por cliente y abre la sede desde el popup del marcador. Nombre de sede
// repetido para el mismo cliente, rechazado con el mensaje exacto de `06_API.md` sección 15.

const env = readE2eClientsSitesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

// Obelisco, CABA: mismo centro por omisión que usan `MapPicker`/`MapView`, así el marcador
// queda visible sin depender de un `fitBounds` particular.
const SITE_LAT = '-34.6037'
const SITE_LNG = '-58.3816'

test.describe('SITE-008: crear sede con coordenadas y verla en el mapa', () => {
  test('la sede nueva aparece en el mapa, el filtro por cliente funciona y el popup abre la ficha; nombre repetido rechazado', async ({
    page,
  }) => {
    const admin = getAdminClient()
    // Cliente A: el que pasa por la interfaz (SITE-008 en sí). Cliente B: solo un control para
    // comprobar que el filtro "Cliente" de ADM-24 de verdad filtra (no aparece cuando se elige
    // A) — se arma directo por API, no es lo que este test prueba.
    const clientA = await createDisposableClient(admin, {
      legalName: disposableName('Cliente Mapa A'),
    })
    const clientB = await createDisposableClient(admin, {
      legalName: disposableName('Cliente Mapa B'),
    })
    const siteName = disposableName('Sede Mapa')

    try {
      await createDisposableSite(admin, clientB.id, {
        name: disposableName('Sede Control B'),
        latitude: -34.61,
        longitude: -58.39,
      })

      await interceptMapRequests(page)
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      let siteAId: string | null = null

      await test.step('crear la sede con coordenadas (ADM-23)', async () => {
        await page.goto(`/admin/sedes/nueva?cliente=${clientA.id}`)
        await page.getByLabel('Nombre').fill(siteName)
        await page
          .getByLabel('Dirección', { exact: true })
          .fill('Av. Corrientes 1234')
        await page.getByLabel('Localidad').fill('CABA')
        await page.getByLabel('Latitud').fill(SITE_LAT)
        await page.getByLabel('Longitud').fill(SITE_LNG)
        await page.getByRole('button', { name: 'Crear sede' }).click()
        await expect(page.getByText('Creamos la sede.')).toBeVisible()
        await expect(page).toHaveURL(/\/admin\/sedes\/[0-9a-f-]+$/)
        const match = page.url().match(/\/admin\/sedes\/([0-9a-f-]+)$/)
        siteAId = match?.[1] ?? null
        expect(
          siteAId,
          'no pudimos leer el id de la sede recién creada',
        ).toBeTruthy()
      })

      await test.step('se ve en el mapa de sedes (ADM-24), filtrada por su cliente', async () => {
        await page.goto('/admin/clientes?pestana=mapa')
        await page
          .getByRole('combobox', { name: 'Filtrar por cliente' })
          .click()
        await page.getByRole('option', { name: clientA.legalName }).click()

        const markerLabel = `${clientA.legalName} — ${siteName}`
        await expect(
          page.getByRole('button', { name: markerLabel }),
        ).toBeVisible()

        // Control: la sede del cliente B no aparece con este filtro.
        await expect(
          page.getByRole('button', {
            name: new RegExp(`^${clientB.legalName} —`),
          }),
        ).toHaveCount(0)
      })

      await test.step('el popup del marcador abre la ficha de la sede', async () => {
        const markerLabel = `${clientA.legalName} — ${siteName}`
        await page.getByRole('button', { name: markerLabel }).click()
        await expect(page.getByRole('link', { name: 'Ver sede' })).toBeVisible()
        await page.getByRole('link', { name: 'Ver sede' }).click()
        await expect(page).toHaveURL(new RegExp(`/admin/sedes/${siteAId}$`))
        await expect(
          page.getByRole('heading', { name: siteName }),
        ).toBeVisible()
      })

      await test.step('nombre de sede repetido para el mismo cliente: rechazado', async () => {
        await page.goto(`/admin/sedes/nueva?cliente=${clientA.id}`)
        await page.getByLabel('Nombre').fill(siteName)
        await page
          .getByLabel('Dirección', { exact: true })
          .fill('Otra dirección cualquiera 456')
        await page.getByRole('button', { name: 'Crear sede' }).click()
        await expect(
          page.getByText('Ya hay una sede con ese nombre para este cliente.'),
        ).toBeVisible()
        // Nunca navegó: seguimos en el alta, no en una segunda sede creada.
        await expect(page).toHaveURL(/\/admin\/sedes\/nueva\?cliente=/)
      })
    } finally {
      await deleteDisposableClient(admin, clientA.id)
      await deleteDisposableClient(admin, clientB.id)
    }
  })
})
