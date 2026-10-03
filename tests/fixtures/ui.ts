// tests/fixtures/ui.ts — TEST-016 (P18.1)
//
// Utilidades de interfaz compartidas por las suites de F18: ingreso por pantalla, mapa sin red,
// scroll horizontal y los selectores de fecha y mes para llegar a un mes lejano.

import { expect, type Page } from '@playwright/test'
import { requireE2eEnv } from './env.ts'

/** Ingreso por la pantalla COM-01 con una cuenta de `App_dev` y espera su pantalla de inicio. */
export async function loginByForm(
  page: Page,
  email: string,
  homePattern: RegExp,
): Promise<void> {
  await page.goto('/ingresar')
  await page.getByLabel('Email').fill(email)
  // `exact: true`: sin esto, `getByLabel('Contraseña')` también matchea "Mostrar contraseña".
  await page
    .getByLabel('Contraseña', { exact: true })
    .fill(requireE2eEnv().seedPassword)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(homePattern)
}

/** PNG de 1×1 transparente (el tile más chico posible). */
const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/**
 * Los e2e no llaman de verdad a Nominatim (límite de uso) ni a los tiles de OpenStreetMap (red
 * externa, estabilidad): se interceptan antes de navegar a cualquier pantalla con mapa.
 */
export async function interceptMapRequests(page: Page): Promise<void> {
  await page.route('https://nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**tile.openstreetmap.org/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(TRANSPARENT_PNG_BASE64, 'base64'),
    }),
  )
}

/** La página no tiene scroll horizontal (`scrollWidth` contra `clientWidth` del elemento raíz). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(
    scrollWidth,
    `scrollWidth (${scrollWidth}) no debería superar clientWidth (${clientWidth}): hay scroll horizontal`,
  ).toBeLessThanOrEqual(clientWidth)
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

/**
 * Abre el `MonthPicker` (ADM-09, grilla propia con "Año anterior"/"Año siguiente") cuyo botón se
 * llama `triggerName` y elige `year`/`month` (1..12).
 */
export async function pickMonth(
  page: Page,
  triggerName: string,
  year: number,
  month: number,
): Promise<void> {
  const yearLabel = page.getByText(/^\d{4}$/, { exact: true })
  // Si el clic cae antes de que la pantalla esté lista, el selector no se abre: se reintenta.
  await expect(async () => {
    if (!(await yearLabel.isVisible())) {
      await page.getByRole('button', { name: triggerName }).click()
    }
    await expect(yearLabel).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
  const currentYear = Number(await yearLabel.textContent())
  const diff = year - currentYear
  const button = page.getByRole('button', {
    name: diff >= 0 ? 'Año siguiente' : 'Año anterior',
  })
  for (let i = 0; i < Math.abs(diff); i++) await button.click()
  await page
    .getByRole('button', {
      name: new RegExp(`^${MESES_ABREVIADOS[month - 1]}\\.?$`, 'i'),
    })
    .click()
}

/**
 * Abre el `DatePicker` (calendario de `react-day-picker`, sin selector de año) cuyo botón se
 * llama `triggerName` y llega a `target` con los atajos de teclado de la librería
 * (`Shift+PageDown` = un año, `PageDown` = un mes, flechas = un día).
 */
export async function pickDate(
  page: Page,
  triggerName: string | RegExp,
  target: { year: number; month: number; day: number },
): Promise<void> {
  await page.getByRole('button', { name: triggerName }).click()
  await page
    .locator('[data-slot="popover-content"][data-state="open"]')
    .waitFor()

  // El día enfocado trae `aria-label` en español: "[Today, ]<día>, <n> de <mes> de <año>".
  const DAY_LABEL_RE = /(\d+) de (\p{L}+) de (\d+)$/u
  let match: RegExpMatchArray | null = null
  for (let attempt = 0; attempt < 4 && !match; attempt++) {
    await page.keyboard.press('Tab')
    const label = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') ?? '',
    )
    match = label.match(DAY_LABEL_RE)
  }
  if (!match) {
    throw new Error(
      'No se pudo enfocar por teclado ningún día del DatePicker después de 4 intentos de Tab.',
    )
  }
  const currentMonth = MESES.indexOf(match[2].toLowerCase()) + 1
  if (currentMonth === 0) {
    throw new Error(`Mes no reconocido en el aria-label del día: "${match[2]}"`)
  }
  const yearDiff = target.year - Number(match[3])
  for (let i = 0; i < Math.abs(yearDiff); i++) {
    await page.keyboard.press(yearDiff >= 0 ? 'Shift+PageDown' : 'Shift+PageUp')
  }
  const monthDiff = target.month - currentMonth
  for (let i = 0; i < Math.abs(monthDiff); i++) {
    await page.keyboard.press(monthDiff >= 0 ? 'PageDown' : 'PageUp')
  }
  const dayDiff = target.day - Number(match[1])
  for (let i = 0; i < Math.abs(dayDiff); i++) {
    await page.keyboard.press(dayDiff >= 0 ? 'ArrowRight' : 'ArrowLeft')
  }
  await page.keyboard.press('Enter')
}

/**
 * Abre un menú de acciones (`DropdownMenu` de Radix) y elige una opción. Se reintenta el conjunto
 * (clic en el botón y espera de la opción) porque, mientras la lista termina de cargar o se
 * refresca, la fila se vuelve a pintar y el menú recién abierto se cierra solo.
 */
export async function chooseMenuItem(
  page: Page,
  triggerName: string | RegExp,
  itemName: string | RegExp,
): Promise<void> {
  await expect(async () => {
    await page.getByRole('button', { name: triggerName }).click()
    await page
      .getByRole('menuitem', { name: itemName })
      .click({ timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
}
