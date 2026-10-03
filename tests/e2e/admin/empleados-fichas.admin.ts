import { expect, test } from '@playwright/test'
import { getAdminDb } from '../../fixtures/accounts.ts'
import { weekdayOf } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-016 (P18.1): ficha del empleado, ADM-17 (RB-A02): habilitaciones por cliente y
// disponibilidad semanal, y su efecto sobre las marcas de ADM-08 (P-034, P-035). El alta, las
// licencias, la baja y los dos roles ya los recorre `tests/e2e-employees/` (EMP-014).
// Cuenta de este archivo: empleado4 (solo se mira, nunca se asigna).

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.use({ storageState: storageStatePath('admin') })

const DIAS = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
]

test(
  'las habilitaciones y la disponibilidad cargadas en la ficha cambian las marcas de ADM-08, y se pueden quitar',
  cubre('RB-A02', 'RB-A04', 'P-034', 'P-035'),
  async ({ page }) => {
    test.setTimeout(180_000)
    const sc = new Scenario()
    const empleadoId = readId('empleado4')
    try {
      const clienteX = await sc.client('habilita-x')
      const clienteY = await sc.client('habilita-y')
      const sedeX = await sc.site(clienteX.id, 'habilita-x')
      const sedeY = await sc.site(clienteY.id, 'habilita-y')
      const turnoX = await sc.shift(clienteX.id, sedeX.id, sc.today, {
        start: '14:00',
        end: '18:00',
      })
      const turnoY = await sc.shift(clienteY.id, sedeY.id, sc.today, {
        start: '14:00',
        end: '18:00',
      })

      const marcasEn = async (turno: string): Promise<string> => {
        await page.goto(`/admin/turnos/${turno}`)
        await page
          .getByRole('dialog', { name: 'Detalle del turno' })
          .getByRole('button', { name: 'Asignar empleado' })
          .click()
        const hoja = page.getByRole('dialog', { name: 'Asignar empleado' })
        const candidato = hoja.getByRole('radio', {
          name: /E2E-Fijo Empleado4/,
        })
        await expect(candidato).toBeVisible()
        return (await candidato.textContent()) ?? ''
      }

      await test.step('sin restricciones, el empleado está habilitado para cualquier cliente', async () => {
        expect(await marcasEn(turnoY)).toContain('Habilitado y disponible')
      })

      await test.step('ADM-17 Habilitaciones: se habilita solo al cliente X', async () => {
        await page.goto(`/admin/empleados/${empleadoId}?pestana=habilitaciones`)
        await page
          .getByRole('combobox', { name: 'Elegir cliente a habilitar' })
          .click()
        await page.getByRole('option', { name: clienteX.name }).click()
        await page.getByRole('button', { name: 'Habilitar' }).click()
        await expect(
          page.getByRole('button', {
            name: `Quitar habilitación para ${clienteX.name}`,
          }),
        ).toBeVisible()
      })

      await test.step('ADM-08: habilitado para X, no habilitado para Y', async () => {
        expect(await marcasEn(turnoX)).toContain('Habilitado y disponible')
        expect(await marcasEn(turnoY)).toContain(
          'No habilitado para el cliente',
        )
      })

      await test.step('al quitar la habilitación, vuelve a estar habilitado para todos', async () => {
        await page.goto(`/admin/empleados/${empleadoId}?pestana=habilitaciones`)
        await page
          .getByRole('button', {
            name: `Quitar habilitación para ${clienteX.name}`,
          })
          .click()
        await page
          .getByRole('dialog', { name: 'Quitar habilitación' })
          .getByRole('button', { name: 'Quitar' })
          .click()
        await expect(
          page.getByText(
            'Esta persona está habilitada para todos los clientes.',
          ),
        ).toBeVisible()
        expect(await marcasEn(turnoY)).toContain('Habilitado y disponible')
      })

      await test.step('ADM-17 Disponibilidad: una franja que no cubre el turno marca "Fuera de su disponibilidad"', async () => {
        const dia = DIAS[weekdayOf(sc.today)]
        await page.goto(`/admin/empleados/${empleadoId}?pestana=disponibilidad`)
        await page.getByRole('combobox', { name: 'Día' }).click()
        await page.getByRole('option', { name: dia, exact: true }).click()
        await page.getByLabel('Desde').fill('08:00')
        await page.getByLabel('Hasta').fill('12:00')
        await page.getByRole('button', { name: 'Agregar' }).click()
        await expect(
          page.getByRole('button', {
            name: `Quitar franja de ${dia}, 08:00 a 12:00`,
          }),
        ).toBeVisible()
        expect(await marcasEn(turnoX)).toContain('Fuera de su disponibilidad')
      })

      await test.step('al quitar la franja, vuelve a figurar disponible', async () => {
        const dia = DIAS[weekdayOf(sc.today)]
        await page.goto(`/admin/empleados/${empleadoId}?pestana=disponibilidad`)
        await page
          .getByRole('button', {
            name: `Quitar franja de ${dia}, 08:00 a 12:00`,
          })
          .click()
        await page
          .getByRole('dialog', { name: 'Quitar franja' })
          .getByRole('button', { name: 'Quitar' })
          .click()
        await expect(
          page.getByText('Todavía no hay disponibilidad cargada'),
        ).toBeVisible()
        expect(await marcasEn(turnoX)).toContain('Habilitado y disponible')
      })
    } finally {
      // Si el test se cortó a mitad de camino, repone la cuenta fija: sin disponibilidad cargada.
      await getAdminDb()
        .from('employee_availability')
        .delete()
        .eq('employee_id', empleadoId)
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
