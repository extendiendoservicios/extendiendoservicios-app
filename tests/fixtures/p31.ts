// tests/fixtures/p31.ts — P31.6
//
// Piezas comunes de las pruebas de las observaciones de la dirección del 23 nov (D-01 a D-14):
// una fecha pasada dentro de un mes, un servicio con un fijo agregado DESPUÉS de crear el turno
// (como en los fijos sin asignar de P30), la limpieza de lo que el escenario no conoce y la lectura
// de las horas trabajadas con la sesión del dueño. Todo con el prefijo `e2e-` y fechas relativas a
// «hoy» en hora de Argentina.

import { expect } from '@playwright/test'
import type { FixedAccountKey } from './accounts.ts'
import { daysFromToday } from './dates.ts'
import { E2E_PREFIX, Scenario, sessionClient } from './scenario.ts'
import { readId } from './sessions.ts'

/**
 * Una fecha pasada con día entre el 3 y el 25 del mes: así el día, el anterior y el siguiente caen
 * en el mismo mes del calendario del empleado, sin importar en qué día corre la prueba.
 */
export function fechaPasada(): string {
  for (const dias of [3, 5, 8, 12, 16, 20]) {
    const fecha = daysFromToday(-dias)
    const dia = Number(fecha.slice(8))
    if (dia >= 3 && dia <= 25) return fecha
  }
  return daysFromToday(-3)
}

/** `AAAA-MM` de una fecha `AAAA-MM-DD`. */
export const mesDe = (fecha: string) => fecha.slice(0, 7)

export interface ServicioConFijo {
  cliente: { id: string; name: string }
  sede: { id: string; name: string }
  servicio: { id: string; name: string }
}

/** Cliente, sede y servicio activo todos los días; el fijo se agrega con `agregarFijo`. */
export async function servicioActivo(
  sc: Scenario,
  slug: string,
  franja = { start: '08:00', end: '10:00' },
): Promise<ServicioConFijo> {
  const cliente = await sc.client(slug)
  const sede = await sc.site(cliente.id, slug)
  const servicio = await sc.service(cliente.id, sede.id, slug, {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    start: franja.start,
    end: franja.end,
  })
  return { cliente, sede, servicio }
}

/** Agrega un fijo al servicio (después de crear los turnos: la persona queda sin asignar). */
export async function agregarFijo(
  sc: Scenario,
  servicioId: string,
  quien: FixedAccountKey,
): Promise<void> {
  const { error } = await sc.db
    .from('service_fixed_employees')
    .insert({ service_id: servicioId, employee_id: readId(quien) })
  expect(error, error?.message).toBeNull()
}

/**
 * Limpieza de lo que cuelga de la persona y el escenario no conoce: las observaciones del calendario
 * que creó la prueba (texto con el prefijo `e2e-`) y su pizarra semanal. Los colores de los clientes
 * de la prueba se van con el cliente.
 */
export async function limpiarPersonaP31(
  sc: Scenario,
  quien: FixedAccountKey,
): Promise<string[]> {
  const notas: string[] = []
  const id = readId(quien)
  const observaciones = await sc.db
    .from('employee_calendar_notes')
    .delete()
    .eq('employee_id', id)
    .like('body', `${E2E_PREFIX}%`)
  if (observaciones.error) {
    notas.push(`observaciones: ${observaciones.error.message}`)
  }
  const pizarra = await sc.db
    .from('employee_week_boards')
    .delete()
    .eq('employee_id', id)
  if (pizarra.error) notas.push(`pizarra: ${pizarra.error.message}`)
  return notas
}

/** Minutos trabajados de una asignación, leídos con la sesión del dueño (la vista es de administración). */
export async function minutosTrabajados(assignmentId: string): Promise<number> {
  const dueno = await sessionClient('owner')
  const { data, error } = await dueno
    .from('v_assignments_board')
    .select('worked_minutes')
    .eq('id', assignmentId)
    .single()
  expect(error, error?.message).toBeNull()
  return Number(data?.worked_minutes ?? -1)
}
