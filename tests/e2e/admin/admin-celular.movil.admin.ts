import { expect, test } from '@playwright/test'
import {
  FRANJAS,
  isTooCloseToMidnight,
  NEAR_MIDNIGHT_MESSAGE,
} from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'
import { expectNoHorizontalScroll } from '../../fixtures/ui.ts'

// TEST-016 (P18.1): criterio de aceptación de RB-X01 (`09_Trazabilidad.md`): "un administrador
// completa desde un celular: ver tablero, asignar un empleado, registrar en nombre de otro,
// asignar una supervisión". Proyecto `mobile` (390 px, táctil): sin scroll horizontal en
// ninguna de las pantallas del recorrido.
// Cuentas y franjas de este archivo: empleado3 (14:00–18:00) para asignar; empleado4
// (00:02–00:03, ya terminó a cualquier hora) para registrar en su nombre; supervisor1.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)
test.skip(isTooCloseToMidnight(), NEAR_MIDNIGHT_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

test(
  'el administrador, desde el celular, ve el tablero, asigna un empleado, registra en nombre de otro y asigna una supervisión',
  cubre('RB-X01', 'RB-A04', 'RB-A07', 'RB-A08', 'RB-S02'),
  async ({ page }) => {
    test.setTimeout(240_000)
    const sc = new Scenario()
    try {
      const cliente = await sc.client('celular')
      const sede = await sc.site(cliente.id, 'celular')
      const turnoAsignar = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS.tarde,
      )
      const turnoRegistrar = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        FRANJAS.madrugada2,
      )
      const asignacion = await sc.assign(turnoRegistrar, 'empleado4')

      await test.step('ADM-02: el tablero se ve en 390 px, sin scroll horizontal y con la barra inferior', async () => {
        await page.goto('/admin')
        await expect(
          page.getByRole('region', { name: 'Indicadores de hoy' }),
        ).toBeVisible()
        await expect(
          page.getByRole('region', { name: 'Servicios de hoy' }),
        ).toBeVisible()
        await expect(page.getByRole('navigation').last()).toBeVisible()
        await expectNoHorizontalScroll(page)
      })

      await test.step('ADM-05 a ADM-08: asigna un empleado a un turno desde la lista del día', async () => {
        await page.goto(`/admin/planificacion?vista=dia&fecha=${sc.today}`)
        await expectNoHorizontalScroll(page)
        await page.getByRole('link', { name: 'Ver' }).first().waitFor()
        await page.goto(`/admin/turnos/${turnoAsignar}`)
        await expectNoHorizontalScroll(page)
        await page.getByRole('button', { name: 'Asignar empleado' }).click()
        await page.getByRole('radio', { name: /E2E-Fijo Empleado3/ }).click()
        await page.getByRole('button', { name: 'Asignar', exact: true }).click()
        await expect(page.getByText('Asignamos al empleado.')).toBeVisible()
        const { data } = await sc.db
          .from('assignments')
          .select('id')
          .eq('shift_id', turnoAsignar)
          .is('removed_at', null)
        expect(data).toHaveLength(1)
      })

      await test.step('ADM-10/11: registra el inicio en nombre de otro empleado', async () => {
        await page.goto('/admin/asistencia')
        await expectNoHorizontalScroll(page)
        await page.getByPlaceholder('Buscar por nombre…').fill('Empleado4')
        await page
          .getByRole('button', { name: 'Registrar en nombre' })
          .first()
          .click()
        await page.getByLabel('Hora').fill(`${sc.today}T00:02`)
        await page
          .getByLabel('Motivo')
          .fill('e2e: avisó por teléfono que ya había llegado')
        await page.getByRole('button', { name: 'Registrar inicio' }).click()
        await expect(page.getByText('Registramos el inicio.')).toBeVisible()
        const { data } = await sc.db
          .from('assignments')
          .select('status')
          .eq('id', asignacion)
          .single()
        expect(data?.status).toBe('present')
      })

      await test.step('ADM-14: asigna una supervisión', async () => {
        await page.goto('/admin/supervisiones/nueva')
        await expectNoHorizontalScroll(page)
        await page.getByRole('combobox', { name: 'Turno' }).click()
        await page
          .getByRole('option', {
            name: new RegExp(`${cliente.name}.*${sede.name}.*14:00–18:00`),
          })
          .click()
        await page.getByRole('combobox', { name: 'Supervisor' }).click()
        await page.getByRole('option', { name: 'E2E-Fijo Supervisor1' }).click()
        await page.getByRole('button', { name: 'Asignar supervisión' }).click()
        await expect(page.getByText('Asignamos al supervisor.')).toBeVisible()
        const { data } = await sc.db
          .from('supervisions')
          .select('status')
          .eq('shift_id', turnoAsignar)
          .single()
        expect(data?.status).toBe('assigned')
      })
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
