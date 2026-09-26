// tests/e2e-checklists/helpers/datePicker.ts — TASK-008 (P12.3)
//
// Copia deliberada de `tests/e2e-shifts-services/helpers/datePicker.ts` (no un import cruzado:
// cada suite de backend real queda autocontenida). Ver ese archivo para la explicación completa
// de por qué se navega por teclado (`react-day-picker` sin selector de año) en vez de a los clics.

import type { Page } from '@playwright/test'

export interface FarDateTarget {
  year: number
  month: number // 1..12
  day: number
}

export async function pickFarDate(
  page: Page,
  triggerName: string,
  target: FarDateTarget,
): Promise<void> {
  await page.getByRole('button', { name: triggerName }).click()
  await page
    .locator('[data-slot="popover-content"][data-state="open"]')
    .waitFor()

  const DAY_LABEL_RE = /(\d+) de (\p{L}+) de (\d+)$/u
  let match: RegExpMatchArray | null = null
  for (let attempt = 0; attempt < 4 && !match; attempt++) {
    await page.keyboard.press('Tab')
    const focusedLabel = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') ?? '',
    )
    match = focusedLabel.match(DAY_LABEL_RE)
  }
  if (!match) {
    throw new Error(
      'No se pudo enfocar por teclado ningún día del DatePicker después de 4 intentos de Tab. ' +
        'Puede que react-day-picker haya cambiado el orden del foco -- revisar a mano.',
    )
  }
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
  const currentDay = Number(match[1])
  const currentMonth = MESES.indexOf(match[2].toLowerCase()) + 1
  const currentYear = Number(match[3])
  if (currentMonth === 0) {
    throw new Error(
      `Mes no reconocido en el aria-label del día enfocado: "${match[2]}"`,
    )
  }

  const yearDiff = target.year - currentYear
  const yearKey = yearDiff >= 0 ? 'Shift+PageDown' : 'Shift+PageUp'
  for (let i = 0; i < Math.abs(yearDiff); i++) {
    await page.keyboard.press(yearKey)
  }

  const monthDiff = target.month - currentMonth
  const monthKey = monthDiff >= 0 ? 'PageDown' : 'PageUp'
  for (let i = 0; i < Math.abs(monthDiff); i++) {
    await page.keyboard.press(monthKey)
  }

  const dayDiff = target.day - currentDay
  const dayKey = dayDiff >= 0 ? 'ArrowRight' : 'ArrowLeft'
  for (let i = 0; i < Math.abs(dayDiff); i++) {
    await page.keyboard.press(dayKey)
  }

  await page.keyboard.press('Enter')
}
