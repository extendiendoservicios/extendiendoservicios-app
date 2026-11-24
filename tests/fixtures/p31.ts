// tests/fixtures/p31.ts — P31.6
//
// Piezas comunes de las pruebas de las observaciones de la dirección del 23 nov (D-01 a D-14):
// una fecha pasada dentro de un mes, un servicio con un fijo agregado DESPUÉS de crear el turno
// (como en los fijos sin asignar de P30), la limpieza de lo que el escenario no conoce y la lectura
// de las horas trabajadas con la sesión del dueño. Todo con el prefijo `e2e-` y fechas relativas a
// «hoy» en hora de Argentina.

import { expect } from '@playwright/test'
import type { FixedAccountKey } from './accounts.ts'
import { daysFromToday, FRANJAS, franjaYaEmpezo } from './dates.ts'
import { FRANJAS_MOVIL } from './movil.ts'
import { E2E_PREFIX, Scenario, sessionClient } from './scenario.ts'
import { readId } from './sessions.ts'
import { cargarJornada } from '../e2e-ajustes-reunion/helpers/historial.ts'

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

/** El turno de hoy, de todo el día, con la persona ya fichada (empezó) y sin salida. */
async function turnoEmpezado(
  sc: Scenario,
  slug: string,
  quien: 'empleado1' | 'empleado2' | 'empleado3' | 'empleado4',
) {
  const cliente = await sc.client(slug)
  const sede = await sc.site(cliente.id, slug)
  const { shiftId } = await cargarJornada(sc, {
    cliente,
    sede,
    fecha: sc.today,
    franja: FRANJAS_MOVIL.diaCompleto,
    quien,
    entrada: '00:00',
  })
  return { cliente, sede, shiftId }
}

export interface EscenarioSupervision {
  supervisado: string
  supervisando: string
  sinSupervision: string
  sinCerrar: string
  sinEmpezar: string | null
}

/** Cuatro turnos empezados (uno por estado de supervisión) y, si todavía se puede, uno sin empezar. */
export async function armarSupervision(
  sc: Scenario,
): Promise<EscenarioSupervision> {
  const a = await turnoEmpezado(sc, 'd10-ok', 'empleado1')
  await sc.supervisionDirecta(a.shiftId, 'supervisor1', {
    estado: 'completada',
  })
  const b = await turnoEmpezado(sc, 'd10-en', 'empleado2')
  await sc.supervisionDirecta(b.shiftId, 'supervisor1', { estado: 'en_curso' })
  const c = await turnoEmpezado(sc, 'd10-no', 'empleado3')
  // «Sin cerrar»: la supervisión sigue `in_progress` pero ya tiene el fin registrado.
  const d = await turnoEmpezado(sc, 'd10-sc', 'empleado4')
  await sc.supervisionDirecta(d.shiftId, 'supervisor1', {
    estado: 'en_curso',
    fin: new Date(Date.now() - 60_000).toISOString(),
  })
  let sinEmpezar: string | null = null
  // Una franja de la noche que todavía no empezó: solo si hoy aún no pasaron las 20:00.
  if (!franjaYaEmpezo(FRANJAS.noche)) {
    const cliente = await sc.client('d10-pend')
    const sede = await sc.site(cliente.id, 'd10-pend')
    const turno = await sc.shift(cliente.id, sede.id, sc.today, FRANJAS.noche)
    await sc.assign(turno, 'dual')
    sinEmpezar = sede.name
  }
  return {
    supervisado: a.sede.name,
    supervisando: b.sede.name,
    sinSupervision: c.sede.name,
    sinCerrar: d.sede.name,
    sinEmpezar,
  }
}
