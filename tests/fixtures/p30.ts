// tests/fixtures/p30.ts — P30.5
//
// Piezas comunes de las pruebas de las observaciones de la dirección del 18 nov (OH-01 a OH-15):
// fechas seguras dentro de un mes, abrir el calendario del empleado, ubicar bloques y limpiar lo que
// el escenario no conoce (licencias guardadas desde la interfaz y la pizarra semanal).

import { expect, type Page } from '@playwright/test'
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

/** Abre la pestaña «Calendario» de la ficha en el mes de `fecha` y espera a que cargue el mes. */
export async function abrirCalendario(
  page: Page,
  quien: FixedAccountKey,
  fecha: string,
): Promise<void> {
  await page.goto(
    `/admin/empleados/${readId(quien)}?pestana=calendario&mes=${mesDe(fecha)}`,
  )
  await expect(page.getByTestId('calendario-mes')).toBeVisible()
  await expect(page.getByTestId(`dia-${fecha}`)).toBeVisible()
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
