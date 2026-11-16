// tests/e2e/admin/p29-usuarios-pasos.ts — P29.6 (OG-12)
//
// Piezas compartidas entre p29-usuarios.admin.ts (escritorio) y p29-usuarios.movil.admin.ts (celular).
// No termina en `.admin.ts`: Playwright no lo toma como archivo de pruebas.

import { expect, type Page } from '@playwright/test'
import { getAdminDb } from '../../fixtures/accounts.ts'
import { readId } from '../../fixtures/sessions.ts'

export const URL_USUARIOS = '/admin/configuracion/usuarios'

/** Filas de la tabla en pantalla (nombre, rol y legajo tal como se leen). */
export async function leerFilas(
  page: Page,
): Promise<Array<{ texto: string; legajo: number | null }>> {
  return page.evaluate(() => {
    const tabla = document.querySelector('table')
    if (!tabla) return []
    const encabezados = Array.from(tabla.querySelectorAll('thead th')).map(
      (th) => th.textContent?.trim().toLowerCase() ?? '',
    )
    const columna = encabezados.findIndex((t) => t.startsWith('legajo'))
    return Array.from(tabla.querySelectorAll('tbody tr')).map((tr) => {
      const celdas = Array.from(tr.querySelectorAll('td'))
      const crudo = celdas[columna]?.textContent?.trim() ?? ''
      return {
        texto: tr.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        legajo: /^\d+$/.test(crudo) ? Number(crudo) : null,
      }
    })
  })
}

export const contador = (page: Page) => page.getByText(/^\d+ de \d+ usuarios$/)

/** Espera a que el listado termine de cargar (aparece el contador). */
export async function esperarListado(page: Page): Promise<void> {
  // Con la base ocupada (otras corridas sobre App_dev) la lista tarda más de los 10 s por omisión.
  await expect(contador(page)).toBeVisible({ timeout: 30_000 })
}

export async function numeros(
  page: Page,
): Promise<{ visibles: number; total: number }> {
  const texto = (await contador(page).textContent()) ?? ''
  const m = texto.match(/^(\d+) de (\d+) usuarios$/)
  return { visibles: Number(m?.[1]), total: Number(m?.[2]) }
}

/** Datos de ficha de una cuenta fija: legajo y DNI de la base. */
export async function ficha(key: 'empleado3' | 'empleado4') {
  const { data, error } = await getAdminDb()
    .from('employees')
    .select('employee_number, dni')
    .eq('profile_id', readId(key))
    .single()
  expect(error, error?.message).toBeNull()
  return { legajo: data?.employee_number as number, dni: data?.dni as string }
}
