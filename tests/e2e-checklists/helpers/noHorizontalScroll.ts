/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test'

/**
 * Comprueba que la página actual no tenga scroll horizontal, comparando `scrollWidth` contra
 * `clientWidth` del elemento raíz — misma comprobación mecánica que
 * `tests/e2e-assignments/helpers/noHorizontalScroll.ts` (copia deliberada, no un import cruzado).
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
