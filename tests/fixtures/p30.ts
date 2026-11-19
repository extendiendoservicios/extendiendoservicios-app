// tests/fixtures/p30.ts — P30.5
//
// Piezas comunes de las pruebas de las observaciones de la dirección del 18 nov (OH-01 a OH-15):
// fechas seguras dentro de un mes, abrir el calendario del empleado, ubicar bloques y limpiar lo que
// el escenario no conoce (licencias guardadas desde la interfaz y la pizarra semanal).

import { expect, type Locator, type Page } from '@playwright/test'
import { addDays, daysFromToday } from './dates.ts'
import type { FixedAccountKey } from './accounts.ts'
import { E2E_PREFIX, type Scenario } from './scenario.ts'
import { readId } from './sessions.ts'

/**
 * Una fecha futura de un mes en la que el día y los tres siguientes quedan dentro del mismo mes
 * (día 3 a 24), así el calendario mensual del empleado los muestra a todos sin saltar de mes.
 */
export function fechaDeMes(minDias = 8): string {
  const fecha = daysFromToday(minDias)
  const dia = Number(fecha.slice(8))
  if (dia > 24) {
    // Primer día del mes siguiente + 4.
    const [y, m] = fecha.split('-').map(Number)
    return addDays(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), 4)
  }
  if (dia < 3) return addDays(fecha, 5 - dia)
  return fecha
}

/** `AAAA-MM` de una fecha `AAAA-MM-DD`. */
export const mesDe = (fecha: string) => fecha.slice(0, 7)

/**
 * Abre la pestaña «Calendario» de la ficha en el mes de `fecha` y espera a que cargue el mes y, si la
 * persona edita, los fijos sin asignar (`employee_fixed_gaps`) y el cronograma semanal: llegan después
 * de la grilla y empujan todo hacia abajo, y un clic o un arrastre medido antes erraría el blanco.
 */
export async function abrirCalendario(
  page: Page,
  quien: FixedAccountKey,
  fecha: string,
): Promise<void> {
  const fijos = page
    .waitForResponse((r) => r.url().includes('employee_fixed_gaps'), {
      timeout: 8_000,
    })
    .catch(() => null)
  await page.goto(
    `/admin/empleados/${readId(quien)}?pestana=calendario&mes=${mesDe(fecha)}`,
  )
  await expect(page.getByTestId('calendario-mes')).toBeVisible()
  await expect(page.getByTestId(`dia-${fecha}`)).toBeVisible()
  await fijos
  // El cronograma semanal de la cabecera (solo para quien edita) también llega tarde y empuja el
  // calendario ~210 px hacia abajo: se espera a que esté dibujado (el coordinador no lo tiene).
  await page
    .getByTestId('cronograma-semanal')
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => undefined)
  // Un cuadro más para que React dibuje lo que acaba de llegar.
  await page.evaluate(
    () => new Promise((resolver) => requestAnimationFrame(resolver)),
  )
}

/** El bloque de tres casillas del turno de la sede (el nombre se muestra en mayúsculas). */
export const bloqueDe = (page: Page, sede: string) =>
  page.getByTestId('turno').filter({ hasText: sede.toUpperCase() })

/** Horario y fecha vigentes de un turno, leídos con la clave de servicio. */
export async function horarioDe(sc: Scenario, turno: string) {
  const { data } = await sc.db
    .from('shifts')
    .select('shift_date, start_time, end_time')
    .eq('id', turno)
    .single()
  return {
    fecha: data!.shift_date,
    inicio: data!.start_time.slice(0, 5),
    fin: data!.end_time.slice(0, 5),
  }
}

/** Asignaciones vigentes de un turno (ids de empleado). */
export async function asignadosDe(
  sc: Scenario,
  turno: string,
): Promise<string[]> {
  const { data } = await sc.db
    .from('assignments')
    .select('employee_id')
    .eq('shift_id', turno)
    .is('removed_at', null)
  return (data ?? []).map((fila) => fila.employee_id)
}

/**
 * Limpieza de lo que cuelga de la persona y el escenario no conoce: las licencias con el prefijo de
 * las pruebas guardadas desde la interfaz (`save_employee_leave`) y su pizarra semanal.
 */
export async function limpiarPersona(
  sc: Scenario,
  quien: FixedAccountKey,
): Promise<string[]> {
  const notas: string[] = []
  const id = readId(quien)
  const licencias = await sc.db
    .from('employee_leaves')
    .delete()
    .eq('employee_id', id)
    .like('reason', `${E2E_PREFIX}%`)
  if (licencias.error) notas.push(`licencias: ${licencias.error.message}`)
  const pizarra = await sc.db
    .from('employee_week_boards')
    .delete()
    .eq('employee_id', id)
  if (pizarra.error) notas.push(`pizarra: ${pizarra.error.message}`)
  return notas
}

/**
 * Arrastre con el mouse de un elemento a otro. El calendario del empleado reacomoda las filas cuando
 * terminan de llegar las consultas (turnos, fijos sin asignar), así que las coordenadas se miden
 * de nuevo justo antes de cada paso y se espera a que el puntero esté de verdad sobre el origen.
 * Deja el botón apretado cuando `soltar` es falso (para mirar el estado intermedio) y devuelve
 * una función que suelta.
 */
export async function arrastrar(
  page: Page,
  origen: Locator,
  destino: Locator,
  { desdeAbajo = true }: { desdeAbajo?: boolean } = {},
): Promise<() => Promise<void>> {
  await origen.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const punto = async () => {
    const caja = (await origen.boundingBox())!
    return {
      x: caja.x + caja.width / 2,
      y: desdeAbajo ? caja.y + caja.height - 4 : caja.y + caja.height / 2,
    }
  }
  const handle = await origen.elementHandle()
  await expect
    .poll(async () => {
      const { x, y } = await punto()
      return page.evaluate(
        ([px, py, el]) => {
          const bajo = document.elementFromPoint(px, py)
          return bajo != null && (el as Element).contains(bajo)
        },
        [x, y, handle] as const,
      )
    })
    .toBe(true)
  const inicio = await punto()
  await page.mouse.move(inicio.x, inicio.y)
  await page.mouse.down()
  await page.mouse.move(inicio.x - 15, inicio.y, { steps: 4 })
  const fin = (await destino.boundingBox())!
  await page.mouse.move(fin.x + fin.width / 2, fin.y + 40, { steps: 10 })
  return () => page.mouse.up()
}
