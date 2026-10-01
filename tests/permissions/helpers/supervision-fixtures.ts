// tests/permissions/helpers/supervision-fixtures.ts — MOB-SUP-014/TEST-012 (P15.6,
// 08_Fases_y_Backlog.md F15)
//
// Fixture de supervisión real para probar las siete RPC de `0029_rpc_supervisions.sql` por API
// directa: algunas cortan con FORBIDDEN ANTES de buscar la fila (`assign_supervision`,
// `cancel_supervision`, `supervision_check_in`, `supervision_check_out`, `complete_supervision` --
// alcanza con cualquier uuid), pero `mark_supervision_not_done` y `rate_employee` buscan la fila
// PRIMERO y solo después miran el permiso (`0029`: "select ... where id = p_supervision_id" antes
// de la rama de permisos) -- con un uuid cualquiera devuelven `SUPERVISION_NOT_FOUND`, no
// `FORBIDDEN`, así que hace falta una supervisión real de otra persona para probar el rechazo de
// verdad. Mismo patrón que `assignment-fixtures.ts`: turno de fixture propio, insertado directo
// con la clave de servicio.

import type { TestClient } from './clients.ts'
import { createFixtureShift, type FixtureShift } from './assignment-fixtures.ts'

export interface FixtureSupervision extends FixtureShift {
  supervisionId: string
  supervisorId: string
}

/**
 * Turno de fixture (creado con la clave de servicio, `admin`) + supervisión asignada de verdad
 * (`assign_supervision`, no un insert directo: `service_role` no tiene `usage` sobre el esquema
 * `app` que usan los triggers, mismo hallazgo que documenta `assignment-fixtures.ts` para
 * `assignments` -- y acá además `auth.uid()` tiene que ser un usuario real, `service_role` no
 * sirve para llamar la RPC). `actorClient` (dueño o administrador con `manage_supervisions`, ya
 * logueado con `loginAs`) es quien llama `assign_supervision`.
 */
export async function createFixtureSupervision(
  admin: TestClient,
  actorClient: TestClient,
  shiftDate: string,
  startTime: string,
  endTime: string,
  supervisorId: string,
): Promise<FixtureSupervision> {
  const shift = await createFixtureShift(admin, shiftDate, startTime, endTime)
  const { data, error } = await actorClient.rpc('assign_supervision', {
    p_shift_id: shift.shiftId,
    p_supervisor_id: supervisorId,
  })
  if (error) {
    throw new Error(
      `No se pudo crear la supervisión de fixture: ${error.message}`,
    )
  }
  const payload = data as { supervision: { id: string } }
  return { ...shift, supervisionId: payload.supervision.id, supervisorId }
}

/** Limpieza: cancela la supervisión (si todavía admite cancelación) antes de cerrar el turno. */
export async function cleanupFixtureSupervision(
  actorClient: TestClient,
  supervision: FixtureSupervision,
): Promise<void> {
  await actorClient.rpc('cancel_supervision', {
    p_supervision_id: supervision.supervisionId,
    p_reason: 'E2E-P114-PERM: limpieza de la supervisión de fixture',
  })
}
