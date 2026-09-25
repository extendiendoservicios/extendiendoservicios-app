// tests/e2e-shifts-services/helpers/monthPicker.ts — SHIFT-012 (P10.4)
//
// `MonthPicker` (`src/components/MonthPicker.tsx`, ADM-09) es una grilla propia, no
// `react-day-picker`: navega el año con dos botones ("Año anterior"/"Año siguiente") y elige el
// mes con un clic sobre su abreviatura. A diferencia de `DatePicker` no hace falta ningún atajo
// de teclado: los botones de año alcanzan para llegar a 2190 (~164 clics desde 2026, confirmado
// que corre en un tiempo razonable contra el build real antes de escribir esta suite).

import type { Page } from '@playwright/test'

const MESES_ABREVIADOS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
]

/** Abre el `MonthPicker` con nombre accesible `triggerName` y elige `year`/`month` (1..12). */
export async function pickFarMonth(
  page: Page,
  triggerName: string,
  year: number,
  month: number,
): Promise<void> {
  await page.getByRole('button', { name: triggerName }).click()
  const yearLabel = page.getByText(/^\d{4}$/, { exact: true })
  await yearLabel.waitFor()

  const currentYear = Number(await yearLabel.textContent())
  const yearDiff = year - currentYear
  const button =
    yearDiff >= 0
      ? page.getByRole('button', { name: 'Año siguiente' })
      : page.getByRole('button', { name: 'Año anterior' })
  for (let i = 0; i < Math.abs(yearDiff); i++) {
    await button.click()
  }

  const monthAbbrev = MESES_ABREVIADOS[month - 1]
  await page
    .getByRole('button', { name: new RegExp(`^${monthAbbrev}\\.?$`, 'i') })
    .click()
}
