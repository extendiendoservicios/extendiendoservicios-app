// tests/e2e-ajustes-reunion/helpers/historial.ts — P19.5d
//
// Jornadas y supervisiones con horas FIJAS en una fecha cualquiera (hoy o pasada), para las
// pruebas de horas, promedios y resúmenes que no dependen del reloj de la corrida: el turno, la
// asignación y la supervisión se arman con las RPC reales (`assign_employee`,
// `assign_supervision`) y la asistencia se carga directo con la clave de servicio, fechada en la
// hora de pared que pide el caso. Los estados se dejan coherentes con lo que quedaría tras fichar.

import type { FixedAccountKey } from '../../fixtures/accounts.ts'
import type { MadeClient, Scenario } from '../../fixtures/scenario.ts'
import { E2E_PREFIX } from '../../fixtures/scenario.ts'

export interface JornadaCargada {
  shiftId: string
  assignmentId: string
}

export interface PedidoJornada {
  cliente: MadeClient
  sede: MadeClient
  fecha: string
  franja: { start: string; end: string }
  quien: FixedAccountKey
  /** `HH:MM` del inicio real; sin él, la asignación queda sin registro. */
  entrada?: string
  /** `HH:MM` del fin real; sin él (y con entrada), la jornada queda en curso. */
  salida?: string
  /** Dotación del turno (por omisión 1). */
  dotacion?: number
}

function ok(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what}: ${error.message}`)
}

/** Turno + asignación + registros de asistencia con las horas pedidas. */
export async function cargarJornada(
  sc: Scenario,
  pedido: PedidoJornada,
): Promise<JornadaCargada> {
  const shiftId = await sc.shift(
    pedido.cliente.id,
    pedido.sede.id,
    pedido.fecha,
    pedido.franja,
    pedido.dotacion ?? 1,
  )
  const assignmentId = await sc.assign(shiftId, pedido.quien)
  await fecharAsistencia(sc, assignmentId, pedido)
  return { shiftId, assignmentId }
}

/** Asigna a otra persona al mismo turno y le carga su propia jornada. */
export async function sumarAlTurno(
  sc: Scenario,
  shiftId: string,
  pedido: PedidoJornada,
): Promise<string> {
  const assignmentId = await sc.assign(shiftId, pedido.quien)
  await fecharAsistencia(sc, assignmentId, pedido)
  return assignmentId
}

async function fecharAsistencia(
  sc: Scenario,
  assignmentId: string,
  pedido: PedidoJornada,
): Promise<void> {
  if (!pedido.entrada) return
  const filas = [
    {
      assignment_id: assignmentId,
      kind: 'check_in' as const,
      recorded_at: `${pedido.fecha}T${pedido.entrada}:00-03:00`,
      source: 'admin' as const,
      reason: `${E2E_PREFIX}horas fijas`,
    },
    ...(pedido.salida
      ? [
          {
            assignment_id: assignmentId,
            kind: 'check_out' as const,
            recorded_at: `${pedido.fecha}T${pedido.salida}:00-03:00`,
            source: 'admin' as const,
            reason: `${E2E_PREFIX}horas fijas`,
          },
        ]
      : []),
  ]
  ok(
    'registros de asistencia',
    (await sc.db.from('attendance_records').insert(filas)).error,
  )
  ok(
    'estado de la asignación',
    (
      await sc.db
        .from('assignments')
        .update({ status: pedido.salida ? 'finished' : 'present' })
        .eq('id', assignmentId)
    ).error,
  )
}

/** Marca el turno como finalizado (todas sus asignaciones ya cerraron). */
export async function finalizarTurno(
  sc: Scenario,
  shiftId: string,
): Promise<void> {
  ok(
    'estado del turno',
    (
      await sc.db
        .from('shifts')
        .update({ status: 'completed' })
        .eq('id', shiftId)
    ).error,
  )
}

export interface PedidoSupervision {
  cliente: MadeClient
  sede: MadeClient
  fecha: string
  franja: { start: string; end: string }
  quien: FixedAccountKey
  entrada: string
  salida: string
}

/** Turno + supervisión (RPC real) con inicio y fin fijos y la supervisión completada. */
export async function cargarSupervision(
  sc: Scenario,
  pedido: PedidoSupervision,
): Promise<{ shiftId: string; supervisionId: string }> {
  const shiftId = await sc.shift(
    pedido.cliente.id,
    pedido.sede.id,
    pedido.fecha,
    pedido.franja,
  )
  const supervisionId = await sc.assignSupervision(shiftId, pedido.quien)
  ok(
    'asistencia de la supervisión',
    (
      await sc.db.from('supervision_attendance').insert([
        {
          supervision_id: supervisionId,
          kind: 'check_in' as const,
          recorded_at: `${pedido.fecha}T${pedido.entrada}:00-03:00`,
        },
        {
          supervision_id: supervisionId,
          kind: 'check_out' as const,
          recorded_at: `${pedido.fecha}T${pedido.salida}:00-03:00`,
        },
      ])
    ).error,
  )
  ok(
    'estado de la supervisión',
    (
      await sc.db
        .from('supervisions')
        .update({ status: 'completed' })
        .eq('id', supervisionId)
    ).error,
  )
  return { shiftId, supervisionId }
}

/** Califica a una asignación (clave de servicio, como el escenario de la matriz de permisos). */
export async function calificarDirecto(
  sc: Scenario,
  supervisionId: string,
  assignmentId: string,
  score: number,
): Promise<void> {
  ok(
    'calificación',
    (
      await sc.db.from('ratings').insert({
        supervision_id: supervisionId,
        assignment_id: assignmentId,
        score,
        comment: `${E2E_PREFIX}calificación`,
      })
    ).error,
  )
}
