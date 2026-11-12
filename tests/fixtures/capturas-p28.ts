// tests/fixtures/capturas-p28.ts — P28.7
//
// Recorrido de las pantallas nuevas del lote P28 con datos propios: captura cada una y comprueba que
// no hay scroll horizontal de la página. Lo comparten `p28-capturas.admin.ts` (proyecto `chromium`,
// 1280 px) y `p28-capturas.movil.admin.ts` (proyecto `mobile`, 390 px): el ancho sale del viewport
// del proyecto. Las capturas quedan en `tests/e2e/capturas-p28/`.

import { expect, type test as baseTest } from '@playwright/test'
import { addDays, daysFromToday, mondayOf } from './dates.ts'
import { capturar } from './capturas.ts'
import { Scenario } from './scenario.ts'
import { readId } from './sessions.ts'
import { expectNoHorizontalScroll, interceptMapRequests } from './ui.ts'
import { sedeGeo } from '../e2e-geo/helpers/geo.ts'

export function definirCapturasP28(
  test: typeof baseTest,
  etiqueta: string,
): void {
  test(`${etiqueta}: pantallas nuevas de P28 (insumos, servicios, feriados, cronograma, mapa y asistencia)`, async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const sc = new Scenario()
    const movil = (page.viewportSize()?.width ?? 1280) < 768
    try {
      const cliente = await sc.client('capt')
      const sede = await sedeGeo(sc, cliente, 'capt', { radio: 100 })
      const servicio = await sc.service(cliente.id, sede.id, 'capt-srv', {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        staff: 2,
        start: '06:00',
        end: '07:00',
      })
      const turnoHoy = await sc.shift(
        cliente.id,
        sede.id,
        sc.today,
        { start: '00:00', end: '23:59' },
        2,
        { serviceId: servicio.id },
      )
      await sc.assign(turnoHoy, 'empleado3')
      const futuro = daysFromToday(4)
      const turnoFuturo = await sc.shift(
        cliente.id,
        sede.id,
        futuro,
        { start: '06:00', end: '07:00' },
        2,
        { serviceId: servicio.id },
      )
      await sc.db
        .from('shifts')
        .update({ generated: true })
        .eq('id', turnoFuturo)
      await sc.assign(turnoFuturo, 'empleado3')

      await interceptMapRequests(page)

      await page.goto('/admin/insumos/nuevo')
      await expect(page.getByLabel(/Precio de costo/)).toHaveValue('0')
      await expectNoHorizontalScroll(page)
      await capturar(page, 'insumo-nuevo-precios-en-cero')

      await page.goto(`/admin/clientes/${cliente.id}?pestana=servicios`)
      await expect(page.getByText(servicio.name)).toBeVisible()
      await expect(page.getByText('Fijos:').first()).toBeVisible()
      await expectNoHorizontalScroll(page)
      await capturar(page, 'servicios-con-asignados')

      await page.goto(`/admin/servicios/${servicio.id}/editar`)
      await expect(page.getByLabel('Nombre')).toHaveValue(servicio.name)
      await page.getByLabel('Dotación').fill('3')
      await page.getByRole('button', { name: 'Guardar cambios' }).click()
      await expect(
        page.getByRole('dialog').getByRole('heading', {
          name: /¿Aplicar los cambios a los turnos desde el/,
        }),
      ).toBeVisible()
      await expect(page.getByRole('dialog')).toContainText(/Se actualiza/)
      await expectNoHorizontalScroll(page)
      await capturar(page, 'servicio-aplicar-cambios')
      await page.getByRole('button', { name: 'No aplicar' }).click()

      await page.goto('/admin/configuracion/feriados')
      await expect(
        page.getByRole('button', { name: 'Nuevo feriado' }),
      ).toBeVisible()
      await expectNoHorizontalScroll(page)
      await capturar(page, 'feriados')

      await page.goto(
        `/admin/empleados/${readId('empleado3')}?pestana=cronograma`,
      )
      await page.getByRole('radio', { name: 'Semana (editar)' }).click()
      await expect(page.getByTestId('cronograma-semana')).toBeVisible()
      const lunesFuturo = mondayOf(futuro)
      if (lunesFuturo !== mondayOf(sc.today)) {
        await page.getByRole('button', { name: 'Semana siguiente' }).click()
      }
      await expect(page.getByTestId('bloque').first()).toBeVisible()
      await expectNoHorizontalScroll(page)
      await capturar(page, 'cronograma-semana', { fullPage: true })
      void addDays

      await page.goto('/admin')
      await expect(
        page.getByRole('region', { name: 'Mapa de presencia' }),
      ).toBeVisible()
      await expect(
        page
          .getByRole('region', { name: 'Mapa de presencia' })
          .getByTitle(new RegExp(`^Sede ${sede.name} \\(`)),
      ).toBeVisible()
      await expectNoHorizontalScroll(page)
      await capturar(page, 'resumen-mapa-por-estado')
      await page.getByRole('button', { name: 'Ampliar mapa' }).first().click()
      await expect(
        page.getByRole('button', { name: 'Salir de pantalla completa' }),
      ).toBeVisible()
      await capturar(page, 'mapa-pantalla-completa')
      await page.keyboard.press('Escape')

      await page.goto('/admin/asistencia')
      await expect(page.getByRole('main')).toBeVisible()
      await expect(
        page.getByRole('switch', { name: 'Cierre automático' }),
      ).toBeVisible()
      await expectNoHorizontalScroll(page)
      await capturar(page, 'asistencia-de-hoy')

      if (movil) {
        await page.goto('/admin/clientes')
        await expect(page.getByRole('table')).toHaveCount(0)
        await capturar(page, 'clientes-tarjetas-celular')
      }
    } finally {
      expect(await sc.cleanup(), 'limpieza').toEqual([])
    }
  })
}
