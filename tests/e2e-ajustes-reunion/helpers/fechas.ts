// tests/e2e-ajustes-reunion/helpers/fechas.ts — P19.5d
//
// Selector de fecha para los `DatePicker` que ya traen una fecha elegida (Desde y Hasta de la
// ficha y del resumen por cliente). P19.12b: antes navegaba con el teclado leyendo el día enfocado,
// y en la corrida nocturna (más lenta, otra hora) el foco no estaba donde se esperaba. Ahora no
// depende del foco: navega mes a mes con los botones del calendario y elige el día por clic, mirando
// en qué mes abrió el calendario para saber hacia dónde ir.

import { expect, type Page } from '@playwright/test'

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

const ETIQUETA_DIA = /(\d+) de (\p{L}+) de (\d+)/u

export interface FechaPartes {
  year: number
  month: number
  day: number
}

export function partesDe(isoDate: string): FechaPartes {
  const [year, month, day] = isoDate.split('-').map(Number)
  return { year, month, day }
}

/** Abre el `DatePicker` cuyo botón se llama `nombre` y elige la fecha indicada. */
export async function elegirFecha(
  page: Page,
  nombre: string,
  objetivo: FechaPartes,
): Promise<void> {
  const abierto = page.locator(
    '[data-slot="popover-content"][data-state="open"]',
  )
  // Que el selector anterior ya haya terminado de cerrarse: si no, el clic puede caer en el
  // momento en que se cierra y el selector no llega a abrirse.
  await expect(abierto).toHaveCount(0)
  await expect(async () => {
    if (!(await abierto.isVisible())) {
      await page.getByRole('button', { name: nombre, exact: true }).click()
    }
    await expect(abierto).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 20_000 })

  const etiqueta = `${objetivo.day} de ${MESES[objetivo.month - 1]} de ${objetivo.year}`
  const dia = abierto
    .getByRole('button', {
      name: new RegExp(`(^|[^0-9])${etiqueta}(,|$)`),
    })
    .first()
  const valorMes = (anio: number, mes: number) => anio * 12 + mes
  const buscado = valorMes(objetivo.year, objetivo.month)
  for (let i = 0; i < 36 && (await dia.count()) === 0; i++) {
    // Mes que muestra el calendario: el del día 15 de la grilla (siempre del mes visible, aunque se muestren días de los meses vecinos).
    const visible = await abierto
      .getByRole('button', { name: ETIQUETA_DIA })
      .nth(14)
      .getAttribute('aria-label')
    const m = visible?.match(ETIQUETA_DIA)
    expect(m, 'el calendario muestra días').not.toBeNull()
    const mesVisible = valorMes(
      Number(m![3]),
      MESES.indexOf(m![2].toLowerCase()) + 1,
    )
    await abierto
      .getByRole('button', {
        name: buscado >= mesVisible ? /mes siguiente/i : /mes anterior/i,
      })
      .click()
  }
  await expect(dia, `el día ${etiqueta} está en el calendario`).toBeVisible()
  await dia.click()
  await expect(abierto).toHaveCount(0)
}
