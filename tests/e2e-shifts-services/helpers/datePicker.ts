// tests/e2e-shifts-services/helpers/datePicker.ts — SERVICE-007/SHIFT-012 (P10.4)
//
// `DatePicker` (`src/components/DatePicker.tsx`) no tiene forma de escribir la fecha a mano: es
// un calendario (`react-day-picker` 10, `src/components/ui/calendar.tsx`) con navegación de a un
// mes por vez (sin selector de año). Llegar a 2190 a los clics ("mes siguiente" × ~1970) no es
// viable en un test — así que esta suite usa los atajos de teclado nativos de `react-day-picker`
// sobre el día enfocado: `PageDown`/`PageUp` avanzan o retroceden un mes, `Shift+PageDown`/
// `Shift+PageUp` un año (confirmado a mano contra el build real antes de escribir esta suite, ver
// el reporte del encargo). Nada de esto es específico de esta app: es el comportamiento estándar
// de la librería, documentado en su propio sitio.
//
// El popover abre con el foco en "hoy" (o en el valor ya elegido, si lo hay), en algún punto del
// ciclo de tres botones "mes anterior" / "mes siguiente" / día enfocado -- confirmado a mano que
// el ciclo tiene siempre esos tres elementos, pero en qué posición arranca el primer `Tab`
// depende del foco previo de la página (por ejemplo, si el turno anterior en el formulario fue
// un `Combobox` recién cerrado): en `ServiceFormPage`, recién abierta, el primer `Tab` cae en
// "mes anterior"; en `ShiftFormPage`, después de elegir cliente y sede con dos `Combobox`, el
// primer `Tab` cae en "mes siguiente" (los dos casos se probaron a mano armando esta suite, ver
// el reporte del encargo). Por eso acá se tabula hasta encontrar un día real (aria-label con
// fecha), no un número fijo de veces.

import type { Page } from '@playwright/test'

export interface FarDateTarget {
  year: number
  month: number // 1..12
  day: number
}

/**
 * Abre el `DatePicker` cuyo botón visible tiene el texto `triggerName` (el valor actual, o el
 * placeholder si todavía no hay ninguno) y navega hasta `target` por teclado, tomando como punto
 * de partida la fecha de hoy (o la ya seleccionada, si el picker abre con foco ahí en vez de en
 * "hoy" — no es el caso de ningún campo que use esta suite, pero se calcula iterando el label del
 * día enfocado en vez de asumir "hoy" a ciegas, por si acaso).
 */
export async function pickFarDate(
  page: Page,
  triggerName: string,
  target: FarDateTarget,
): Promise<void> {
  await page.getByRole('button', { name: triggerName }).click()
  // Espera a que el popover esté de verdad en el DOM antes de tabular: sin esto, los primeros
  // `Tab` pueden perderse mientras `Popover`/`react-day-picker` todavía están montando
  // (encontrado armando esta suite, ver el reporte del encargo).
  await page
    .locator('[data-slot="popover-content"][data-state="open"]')
    .waitFor()

  // El `aria-label` del día enfocado viene en español, con la forma
  // "[Today, ]<día de la semana>, <día> de <mes> de <año>" — solo interesa el año, el mes (por
  // nombre) y el día, los tres al final.
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
