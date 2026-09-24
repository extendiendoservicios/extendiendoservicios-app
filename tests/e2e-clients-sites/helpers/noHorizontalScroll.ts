/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test'

/**
 * TEST-005 (encargo P08.5, criterio de F8 "Todo funciona en celular"): comprueba que la página
 * actual no tenga scroll horizontal, comparando `scrollWidth` contra `clientWidth` del elemento
 * raíz — la misma comprobación mecánica que pide el encargo, no una inspección visual.
 */
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
