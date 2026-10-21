// tests/e2e-assignments/helpers/monthPicker.ts — ASSIGN-016 (P11.4)
//
// `MonthPicker` (`src/components/MonthPicker.tsx`, ADM-03/ADM-09) es una grilla propia, no
// `react-day-picker`: navega el año con dos botones y elige el mes con un clic sobre su
// abreviatura. Copia deliberada de `tests/e2e-shifts-services/helpers/monthPicker.ts` (no un
// import cruzado: cada suite de backend real queda autocontenida).

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
  // Todo se busca dentro del selector abierto: fuera de él hay otros textos de cuatro cifras (por
  // ejemplo, números de turnos del calendario) y el selector de año quedaba ambiguo.
  const popover = page.locator(
    '[data-slot="popover-content"][data-state="open"]',
  )
  const yearLabel = popover.getByText(/^\d{4}$/)
  await yearLabel.waitFor()

  const currentYear = Number(await yearLabel.textContent())
  const yearDiff = year - currentYear
  const button =
    yearDiff >= 0
      ? popover.getByRole('button', { name: 'Año siguiente' })
      : popover.getByRole('button', { name: 'Año anterior' })
  for (let i = 0; i < Math.abs(yearDiff); i++) {
    await button.click()
  }

  const monthAbbrev = MESES_ABREVIADOS[month - 1]
  await popover
    .getByRole('button', { name: new RegExp(`^${monthAbbrev}\\.?$`, 'i') })
    .click()
}
