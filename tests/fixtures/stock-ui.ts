// tests/fixtures/stock-ui.ts — P25.5c (módulo E, Insumos)
//
// Piezas de interfaz que repiten las suites de Insumos: elegir en los desplegables del diseño
// (Radix Select) y en los buscadores con lista (`Combobox`, cmdk).

import { expect, type Locator, type Page } from '@playwright/test'

/** Elige una opción de un desplegable del diseño (el botón con ese nombre accesible). */
export async function elegirSelect(
  page: Page,
  nombre: string | RegExp,
  opcion: string | RegExp,
  dentro?: Locator,
): Promise<void> {
  // Las opciones salen en un portal, fuera de un diálogo: se buscan siempre en la página.
  await (dentro ?? page).getByRole('combobox', { name: nombre }).click()
  await page.getByRole('option', { name: opcion }).click()
}

/**
 * Abre un buscador con lista (`Combobox`), escribe para filtrar y elige la opción. `buscar` es el
 * texto que se escribe (acota la lista); `opcion` es el nombre de la opción a tocar.
 */
export async function elegirDeLista(
  page: Page,
  nombre: string | RegExp,
  buscar: string,
  opcion: string | RegExp,
): Promise<void> {
  await page.getByRole('combobox', { name: nombre }).click()
  const cuadro = page.locator('[cmdk-input]')
  await cuadro.fill(buscar)
  await page.getByRole('option', { name: opcion }).first().click()
  await expect(cuadro).toHaveCount(0)
}

/** Fila de la tabla de Stock de un artículo (por su nombre, que lleva el prefijo `e2e-`). */
export function filaDeStock(page: Page, nombre: string) {
  return page.getByRole('row').filter({ hasText: nombre })
}

/** Busca en la pestaña Stock por código o nombre y espera la fila. */
export async function buscarEnStock(page: Page, texto: string): Promise<void> {
  await page.getByLabel('Buscar por código o nombre').fill(texto)
  // La búsqueda tiene un retraso (antirrebote): hasta que no se aplica, la tabla sigue con todos
  // los artículos y un clic sobre «el único botón» cae en un conflicto de varios. Se espera a que
  // quede alguna fila con el texto y ninguna otra (la única fila sin el texto es el encabezado).
  const filas = page.getByRole('row')
  await expect(filas.filter({ hasText: texto }).first()).toBeVisible()
  await expect
    .poll(async () => filas.filter({ hasNotText: texto }).count(), {
      message: `la tabla de Stock sigue mostrando artículos que no son «${texto}»`,
    })
    .toBeLessThanOrEqual(1)
}
