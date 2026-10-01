// tests/e2e-supervisiones/helpers/datePicker.ts — SUP-013 (P15.6)
//
// `DatePicker` (`src/components/DatePicker.tsx`) no tiene forma de escribir la fecha a mano: es
// un calendario (`react-day-picker` 10, `src/components/ui/calendar.tsx`) con navegación de a un
// mes por vez. Copia deliberada de `tests/e2e-shifts-services/helpers/datePicker.ts` (no un
// import cruzado, cada suite queda autocontenida): acá solo hace falta moverse UN día (hoy ->
// mañana), pero el mismo mecanismo genérico por teclado sirve igual y evita reinventar la
// detección del día enfocado inicial.

import type { Page } from '@playwright/test'

export interface FarDateTarget {
  year: number
  month: number // 1..12
  day: number
}

/**
 * Abre el `DatePicker` cuyo botón visible tiene el texto `triggerName` (su `aria-label`, fijo,
 * no el valor mostrado) y navega hasta `target` por teclado, tomando como punto de partida la
 * fecha enfocada al abrir (hoy o la ya seleccionada).
 */
export async function pickFarDate(
  page: Page,
  triggerName: string,
  target: FarDateTarget,
): Promise<void> {
  await page.getByRole('button', { name: triggerName }).click()
  await page
    .locator('[data-slot="popover-content"][data-state="open"]')
    .waitFor()

  // El `aria-label` del día enfocado viene en español, con la forma
  // "[Today, ]<día de la semana>, <día> de <mes> de <año>" — solo interesa el año, el mes (por
  // nombre) y el día, los tres al final.
  // Sin anclar el final (`$`): cuando el `DatePicker` ya tiene un valor (p. ej. `AssignSupervisionForm`
  // arranca en "hoy"), react-day-picker agrega ", selected" después de la fecha en el
  // `aria-label` del día ya elegido ("Today, jueves, 1 de octubre de 2026, selected") -- el
  // patrón original (con `$`) nunca matcheaba ese caso.
  const DAY_LABEL_RE = /(\d+) de (\p{L}+) de (\d+)/u
  let match: RegExpMatchArray | null = null
  // Hasta 10 intentos (no 4, como la copia original de `tests/e2e-shifts-services/`): dentro de
  // un `Sheet` (ADM-14 es un drawer, no una página simple) el ciclo de foco antes de llegar a un
  // día real es más largo -- confirmado a mano contra el build real armando esta suite.
  for (let attempt = 0; attempt < 10 && !match; attempt++) {
    await page.keyboard.press('Tab')
    const focusedLabel = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') ?? '',
    )
    match = focusedLabel.match(DAY_LABEL_RE)
  }
  if (!match) {
    throw new Error(
      'No se pudo enfocar por teclado ningún día del DatePicker después de 10 intentos de Tab.',
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
