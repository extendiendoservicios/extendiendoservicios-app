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

// CLIENT-008 (08_Fases_y_Backlog.md F8, CLIENT-005 "e2e alta de cliente completo"): un
// administrador da de alta un cliente con CUIT, carga dos contactos (uno principal, cambia cuál
// es el principal), un segundo cliente con el mismo CUIT es rechazado con el mensaje exacto de
// `06_API.md` sección 15, y cambia el estado del primero a "Suspendido".

const env = readE2eClientsSitesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('CLIENT-008: alta de cliente completo', () => {
  test('cliente con CUIT, dos contactos (cambio de principal) y suspensión; CUIT repetido rechazado', async ({
    page,
  }) => {
    const admin = getAdminClient()
    const legalName = disposableName('Cliente Alta Completa')
    const cuit = disposableCuit()
    let clientId: string | null = null

    try {
      await interceptMapRequests(page)
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      await test.step('alta del cliente con CUIT (ADM-20)', async () => {
        await page.goto('/admin/clientes/nuevo')
        await page.getByLabel('Razón social').fill(legalName)
        await page.getByLabel('CUIT').fill(cuit)
        await page
          .getByLabel('Dirección administrativa')
          .fill('Av. Siempre Viva 742')
        await page.getByRole('button', { name: 'Crear cliente' }).click()
        await expect(page.getByText('Creamos el cliente.')).toBeVisible()
        await expect(page).toHaveURL(/\/admin\/clientes\/[0-9a-f-]+$/)
        const match = page.url().match(/\/admin\/clientes\/([0-9a-f-]+)$/)
        clientId = match?.[1] ?? null
        expect(
          clientId,
          'no pudimos leer el id del cliente recién creado',
        ).toBeTruthy()
        await expect(
          page.getByRole('heading', { name: legalName }),
        ).toBeVisible()
      })

      await test.step('primer contacto, marcado principal desde el alta', async () => {
        await page.getByRole('tab', { name: 'Contactos' }).click()
        await page.getByRole('button', { name: 'Nuevo contacto' }).click()
        await page.getByLabel('Nombre').fill('Ana Contacto Principal')
        await page.getByLabel('Teléfono').fill('1122334455')
        await page.getByLabel('Contacto principal').check()
        await page.getByRole('button', { name: 'Guardar' }).click()
        await expect(page.getByText('Agregamos el contacto.')).toBeVisible()
        const primaryRow = page
          .getByRole('listitem')
          .filter({ hasText: 'Ana Contacto Principal' })
        await expect(
          primaryRow.getByText('Principal', { exact: true }),
        ).toBeVisible()
      })

      await test.step('segundo contacto, sin marcar principal', async () => {
        await page.getByRole('button', { name: 'Nuevo contacto' }).click()
        await page.getByLabel('Nombre').fill('Beto Contacto Secundario')
        await page.getByLabel('Teléfono').fill('1155667788')
        await page.getByRole('button', { name: 'Guardar' }).click()
        await expect(page.getByText('Agregamos el contacto.')).toBeVisible()
        await expect(page.getByText('Beto Contacto Secundario')).toBeVisible()
      })

      await test.step('cambia el contacto principal al segundo', async () => {
        await page
          .getByRole('button', {
            name: 'Acciones para Beto Contacto Secundario',
          })
          .click()
        await page
          .getByRole('menuitem', { name: 'Marcar como principal' })
          .click()
        await expect(
          page.getByText(
            'Marcamos a Beto Contacto Secundario como contacto principal.',
          ),
        ).toBeVisible()

        const secondaryRow = page
          .getByRole('listitem')
          .filter({ hasText: 'Beto Contacto Secundario' })
        await expect(
          secondaryRow.getByText('Principal', { exact: true }),
        ).toBeVisible()

        // Ana deja de ser la principal: ya no tiene la insignia, y vuelve a ofrecer "Marcar
        // como principal" en su propio menú (índice único parcial, un solo principal por
        // cliente — `client_contacts_one_primary_per_client_idx`).
        const anaRow = page
          .getByRole('listitem')
          .filter({ hasText: 'Ana Contacto Principal' })
        await expect(
          anaRow.getByText('Principal', { exact: true }),
        ).toHaveCount(0)
        await anaRow.getByRole('button', { name: /^Acciones para/ }).click()
        await expect(
          page.getByRole('menuitem', { name: 'Marcar como principal' }),
        ).toBeVisible()
        await page.keyboard.press('Escape')
      })

      await test.step('CUIT repetido: rechazado con el mensaje exacto de 06 sección 15', async () => {
        await page.goto('/admin/clientes/nuevo')
        await page
          .getByLabel('Razón social')
          .fill(disposableName('Cliente CUIT Duplicado'))
        await page.getByLabel('CUIT').fill(cuit)
        await page.getByRole('button', { name: 'Crear cliente' }).click()
        await expect(
          page.getByText('Ese CUIT ya está registrado.'),
        ).toBeVisible()
        // Nunca navegó: seguimos en el formulario de alta, no en un detalle nuevo.
        await expect(page).toHaveURL(/\/admin\/clientes\/nuevo$/)
      })

      await test.step('cambia el estado del cliente a Suspendido', async () => {
        await page.goto(`/admin/clientes/${clientId}`)
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
        // `exact: true`: sin esto, "Suspendido" (el badge) también matchea, sin distinguir
        // mayúsculas/minúsculas, la descripción de otro estado que quedó en el DOM del diálogo ya
        // cerrado ("... mientras esté suspendido.") — `getByText` normaliza y compara sin
        // distinguir may/min por omisión.
        await expect(
          page.getByText('Suspendido', { exact: true }),
        ).toBeVisible()
      })
    } finally {
      if (clientId) {
        await deleteDisposableClient(admin, clientId)
      }
    }
  })
})
