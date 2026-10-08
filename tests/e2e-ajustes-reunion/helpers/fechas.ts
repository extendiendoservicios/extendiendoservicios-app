// tests/e2e-ajustes-reunion/helpers/fechas.ts — P19.5d
//
// Selector de fecha para los `DatePicker` que ya traen una fecha elegida (Desde y Hasta de la
// ficha y del resumen por cliente). `pickDate` de `tests/fixtures/ui.ts` supone un calendario sin
// fecha elegida (el primer Tab entra al día enfocado); con una fecha elegida el calendario abre con
// ese día ya enfocado y un Tab lo sacaría. Acá se lee primero el día enfocado y recién después se
// prueba con Tab. Misma navegación por teclado de `react-day-picker`.

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

// Con una fecha elegida la etiqueta del día termina en ", selected".
const ETIQUETA_DIA = /(\d+) de (\p{L}+) de (\d+)(?:, selected)?$/u

export interface FechaPartes {
  year: number
  month: number
  day: number
}

export function partesDe(isoDate: string): FechaPartes {
  const [year, month, day] = isoDate.split('-').map(Number)
  return { year, month, day }
}

async function diaEnfocado(page: Page): Promise<RegExpMatchArray | null> {
  const etiqueta = await page.evaluate(
    () => document.activeElement?.getAttribute('aria-label') ?? '',
  )
  return etiqueta.match(ETIQUETA_DIA)
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
  // momento en que se cierra y el selector no llega a abrirse (se vio una vez en 3 corridas).
  await expect(abierto).toHaveCount(0)
  await expect(async () => {
    if (!(await abierto.isVisible())) {
      await page.getByRole('button', { name: nombre, exact: true }).click()
    }
    await expect(abierto).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 20_000 })

  let encontrado: RegExpMatchArray | null = null
  await expect(async () => {
    encontrado = await diaEnfocado(page)
    if (!encontrado) {
      await page.keyboard.press('Tab')
      encontrado = await diaEnfocado(page)
    }
    expect(encontrado, 'hay un día enfocado en el calendario').not.toBeNull()
  }).toPass({ timeout: 10_000 })

  const [, dia, mes, anio] = encontrado!
  const mesActual = MESES.indexOf(mes.toLowerCase()) + 1
  expect(mesActual, `mes reconocido: ${mes}`).toBeGreaterThan(0)

  const dAnios = objetivo.year - Number(anio)
  for (let i = 0; i < Math.abs(dAnios); i++) {
    await page.keyboard.press(dAnios >= 0 ? 'Shift+PageDown' : 'Shift+PageUp')
  }
  const dMeses = objetivo.month - mesActual
  for (let i = 0; i < Math.abs(dMeses); i++) {
    await page.keyboard.press(dMeses >= 0 ? 'PageDown' : 'PageUp')
  }
  // Tras mover meses el día enfocado puede haberse ajustado (por ejemplo del 31 al 30): se relee.
  const despues = await diaEnfocado(page)
  const diaActual = despues ? Number(despues[1]) : Number(dia)
  const dDias = objetivo.day - diaActual
  for (let i = 0; i < Math.abs(dDias); i++) {
    await page.keyboard.press(dDias >= 0 ? 'ArrowRight' : 'ArrowLeft')
  }
  await page.keyboard.press('Enter')
  await expect(abierto).toHaveCount(0)
}
