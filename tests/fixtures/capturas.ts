// tests/fixtures/capturas.ts — P28.7
//
// Captura de pantalla de las pantallas nuevas del lote P28, a 1280 y a 390 px, en
// `tests/e2e/capturas-p28/<nombre>-<ancho>.png` (el ancho sale del viewport de la página).

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

const CARPETA = path.join(
  fileURLToPath(new URL('../..', import.meta.url)),
  'tests',
  'e2e',
  'capturas-p28',
)

export async function capturar(
  page: Page,
  nombre: string,
  opciones: { fullPage?: boolean } = {},
): Promise<void> {
  mkdirSync(CARPETA, { recursive: true })
  const ancho = page.viewportSize()?.width ?? 0
  await page.screenshot({
    path: path.join(CARPETA, `${nombre}-${ancho}.png`),
    fullPage: opciones.fullPage ?? false,
  })
}
