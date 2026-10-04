import { expect, test } from '@playwright/test'
import { getAdminDb } from '../../fixtures/accounts.ts'
import { addDays } from '../../fixtures/dates.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { storageStatePath } from '../../fixtures/sessions.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-020 (P18.4): CB-23, dos administradores editan el mismo turno a la vez.
// Decisión de Mike (3 oct 2026, `08` sección 3, corregida): GANA EL ÚLTIMO QUE GUARDA, sin
// bloqueo optimista y SIN AVISO. El segundo administrador recibe el estado actualizado tras
// guardar. Los dos abren el formulario de edición (ADM-07) con el mismo turno; el primero guarda
// y el segundo, que tiene la copia vieja en pantalla, guarda después.
// Cuentas: `admin` y `adminSinCapacidades` (editar la franja y la dotación no exige capacidad; no
// se les cambia nada a las cuentas). Sin empleados.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test(
  'CB-23: el segundo administrador que guarda gana, no hay aviso y ve el estado actualizado',
  cubre('RB-A04', 'CB-23', 'P-051'),
  async ({ browser }) => {
    const sc = new Scenario()
    const contextoA = await browser.newContext({
      storageState: storageStatePath('admin'),
      baseURL: test.info().project.use.baseURL,
    })
    const contextoB = await browser.newContext({
      storageState: storageStatePath('adminSinCapacidades'),
      baseURL: test.info().project.use.baseURL,
    })
    try {
      const cliente = await sc.client('cb23')
      const sede = await sc.site(cliente.id, 'cb23')
      // Tres días adelante: el turno nunca "ya empezó" a ninguna hora del día.
      const fecha = addDays(sc.today, 3)
      const turnoId = await sc.shift(
        cliente.id,
        sede.id,
        fecha,
        { start: '08:00', end: '12:00' },
        1,
      )

      const paginaA = await contextoA.newPage()
      const paginaB = await contextoB.newPage()
      const editar = `/admin/turnos/${turnoId}/editar`

      await test.step('los dos abren el formulario con la misma versión del turno', async () => {
        for (const pagina of [paginaA, paginaB]) {
          await pagina.goto(editar)
          await expect(pagina.getByLabel('Desde')).toHaveValue('08:00')
          await expect(pagina.getByLabel('Hasta')).toHaveValue('12:00')
        }
      })

      await test.step('A guarda primero: 09:00 a 13:00, dotación 2', async () => {
        await paginaA.getByLabel('Desde').fill('09:00')
        await paginaA.getByLabel('Hasta').fill('13:00')
        await paginaA.getByLabel('Dotación').fill('2')
        await paginaA.getByRole('button', { name: 'Guardar cambios' }).click()
        await expect(
          paginaA.getByText('Actualizamos el turno.').last(),
        ).toBeVisible()
      })

      await test.step('B, con la copia vieja en pantalla, guarda después: 10:00 a 14:00, dotación 3', async () => {
        // B todavía muestra lo de antes de que A guardara.
        await expect(paginaB.getByLabel('Desde')).toHaveValue('08:00')
        await paginaB.getByLabel('Desde').fill('10:00')
        await paginaB.getByLabel('Hasta').fill('14:00')
        await paginaB.getByLabel('Dotación').fill('3')
        await paginaB.getByRole('button', { name: 'Guardar cambios' }).click()
        await expect(
          paginaB.getByText('Actualizamos el turno.').last(),
          'el segundo guarda sin error ni aviso de que el turno cambió',
        ).toBeVisible()
        await expect(
          paginaB.getByText(/otro administrador|ya fue modificado|cambió/i),
          'la Base no avisa de conflictos (CB-23)',
        ).toHaveCount(0)
      })

      await test.step('quedó lo de B (gana el último que guarda)', async () => {
        const { data, error } = await getAdminDb()
          .from('shifts')
          .select('start_time, end_time, required_staff')
          .eq('id', turnoId)
          .single()
        expect(error, error?.message).toBeNull()
        expect(data?.start_time.slice(0, 5)).toBe('10:00')
        expect(data?.end_time.slice(0, 5)).toBe('14:00')
        expect(data?.required_staff).toBe(3)
      })

      await test.step('B ve el estado actualizado en la lista del día, y A también al recargar', async () => {
        await expect(paginaB).toHaveURL(new RegExp(`fecha=${fecha}`))
        const filaB = paginaB.getByRole('row').filter({ hasText: cliente.name })
        await expect(filaB).toContainText('10:00–14:00')
        await expect(filaB).toContainText('0/3')

        await paginaA.goto(`/admin/planificacion?vista=dia&fecha=${fecha}`)
        const filaA = paginaA.getByRole('row').filter({ hasText: cliente.name })
        await expect(filaA).toContainText('10:00–14:00')
        await expect(filaA).toContainText('0/3')
      })
    } finally {
      await contextoA.close()
      await contextoB.close()
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  },
)
