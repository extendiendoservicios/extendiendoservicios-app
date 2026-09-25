// tests/e2e-shifts-services/service-crud.spec.ts — SERVICE-007 (P10.4, 08_Fases_y_Backlog.md
// F10, fila "e2e alta y edición de servicio")
//
// Alta de un servicio recurrente desde ADM-25 (`?cliente=` desde la pestaña "Servicios" de
// ADM-21), validaciones del formulario (`04_Modelo_de_Datos.md` sección 2.3:
// `services_weekdays_check`, `services_time_range_check`) y edición (con el aviso "los turnos
// ya generados no cambian"). Corre con fechas de vigencia cercanas a hoy (crear o editar un
// servicio NO llama a `generate_shifts`: no hace falta el mes lejano reservado de
// `helpers/farDate.ts`, que es solo para los specs que sí generan turnos).
//
// Cliente y sede: precondición por API directa (esto no es lo que prueba SERVICE-007 — eso ya
// lo prueba `tests/e2e-clients-sites/client-full-signup.spec.ts`).

import { expect, test } from '@playwright/test'
import { readE2eShiftsServicesEnv, MISSING_ENV_MESSAGE } from './helpers/env.ts'
import {
  cleanupDisposableClient,
  createDisposableClient,
  createDisposableSite,
  getAdminClient,
} from './helpers/adminClient.ts'
import { loginAs } from './helpers/login.ts'
import { SEED_ACCOUNTS } from '../permissions/fixtures/seed-accounts.ts'

const env = readE2eShiftsServicesEnv()
test.skip(!env, MISSING_ENV_MESSAGE)

test.describe('SERVICE-007: alta y edición de servicio (ADM-25)', () => {
  test('crea un servicio, lo ve en la lista, lo edita y las validaciones del formulario funcionan', async ({
    page,
  }) => {
    const admin = getAdminClient()
    const client = await createDisposableClient(admin, 'Cliente-Alta')
    const site = await createDisposableSite(admin, client.id, 'Sede-Alta')
    const serviceIds: string[] = []

    try {
      await loginAs(page, SEED_ACCOUNTS.owner, env!.seedPassword, /\/admin$/)

      await test.step('validaciones: sin días de la semana y horario invertido', async () => {
        await page.goto(`/admin/servicios/nuevo?cliente=${client.id}`)
        await page.getByRole('combobox', { name: 'Sede' }).click()
        await page.getByRole('option', { name: site.name }).click()
        await page.getByLabel('Nombre').fill('E2E-P104 Servicio sin días')
        await page.getByLabel('Desde').first().fill('10:00')
        await page.getByLabel('Hasta').first().fill('08:00')
        await page.getByRole('button', { name: 'Crear servicio' }).click()
        await expect(
          page.getByText('Elegí al menos un día de la semana.'),
        ).toBeVisible()
        await expect(
          page.getByText(
            'La hora de fin tiene que ser posterior a la de inicio.',
          ),
        ).toBeVisible()
      })

      let createdName = ''
      await test.step('alta completa desde ADM-25', async () => {
        createdName = `E2E-P104 Servicio ${Date.now()}`
        await page.getByLabel('Nombre').fill(createdName)
        await page.getByLabel('Lunes').check()
        await page.getByLabel('Miércoles').check()
        await page.getByLabel('Desde').first().fill('08:00')
        await page.getByLabel('Hasta').first().fill('12:00')
        await page.getByRole('button', { name: 'Vigente desde' }).click()
        // El calendario abre mostrando el mes de hoy; el botón de "hoy" tiene un aria-label
        // propio ("Today, …") que lo distingue sin ambigüedad de cualquier otro día visible.
        await page.getByRole('button', { name: /^Today,/ }).click()
        await page.getByRole('button', { name: 'Crear servicio' }).click()
        await expect(page.getByText('Creamos el servicio.')).toBeVisible()
        await expect(page).toHaveURL(
          new RegExp(`/admin/clientes/${client.id}\\?pestana=servicios`),
        )
        await expect(page.getByText(createdName)).toBeVisible()
      })

      // Guarda el id recién creado para la limpieza y para la edición siguiente.
      const { data: created } = await admin
        .from('services')
        .select('id')
        .eq('name', createdName)
        .single()
      const serviceId = created!.id as string
      serviceIds.push(serviceId)

      await test.step('edición: aviso de "los turnos no cambian" y guarda el nuevo nombre', async () => {
        await page.goto(`/admin/servicios/${serviceId}/editar`)
        await expect(
          page.getByText(
            'Los turnos ya generados no cambian. Si hace falta, generá el mes de',
          ),
        ).toBeVisible()
        const editedName = `${createdName} (editado)`
        await page.getByLabel('Nombre').fill(editedName)
        await page.getByRole('button', { name: 'Guardar cambios' }).click()
        await expect(
          page.getByText('Guardamos los cambios del servicio.'),
        ).toBeVisible()
        await expect(page.getByText(editedName)).toBeVisible()
      })
    } finally {
      await cleanupDisposableClient(admin, client.id, serviceIds)
    }
  })
})
