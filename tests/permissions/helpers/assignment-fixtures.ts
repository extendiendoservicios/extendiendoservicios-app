// tests/permissions/helpers/assignment-fixtures.ts — TEST-008 (P11.4, 08_Fases_y_Backlog.md F11)
//
// Fixtures mínimas para probar `assign_employee`, `remove_assignment`, `update_assignment_time`
// y `update_shift_details` por API directa: un cliente y una sede propios, y un turno puntual
// insertado directo con la clave de servicio (sin pasar por `create_shift`, que no es lo que se
// está probando acá). Copia deliberada del criterio de
// `tests/e2e-shifts-services/helpers/adminClient.ts` y `tests/e2e-assignments/helpers/adminClient.ts`
// (no un import cruzado: esta carpeta usa su propio `TestClient` tipado con `Database`, y corre
// con un config de Vitest propio, no con Playwright).

import type { TestClient } from './clients.ts'

export const PERMISSIONS_NAME_PREFIX = 'E2E-P114-PERM'

export interface FixtureShift {
  clientId: string
  siteId: string
  shiftId: string
  shiftDate: string
}

/**
 * Turno puntual de fixture. `shiftDate`/`startTime`/`endTime` los decide quien llama: los casos
 * de "antes de empezar" usan una fecha cercana a hoy (regla común: fechas relativas a "hoy"); el
 * caso de administrador sin `manage_attendance` necesita un turno YA empezado, así que usa hoy
 * con una hora ya pasada (no hay forma de probar `SHIFT_STARTED` en un mes lejano: depende del
 * reloj real).
 */
export async function createFixtureShift(
  admin: TestClient,
  shiftDate: string,
  startTime: string,
  endTime: string,
): Promise<FixtureShift> {
  const suffix = Date.now()
  const { data: client, error: clientError } = await admin
    .from('clients')
    .insert({
      legal_name: `${PERMISSIONS_NAME_PREFIX} Cliente ${suffix}`,
      cuit: `20${String(suffix).slice(-8)}0`,
      status: 'active',
    })
    .select('id')
    .single()
  if (clientError) {
    throw new Error(
      `No se pudo crear el cliente de fixture: ${clientError.message}`,
    )
  }

  const { data: site, error: siteError } = await admin
    .from('sites')
    .insert({
      client_id: client.id,
      name: `${PERMISSIONS_NAME_PREFIX} Sede ${suffix}`,
      address: 'Dirección de prueba, sin importancia',
      status: 'active',
    })
    .select('id')
    .single()
  if (siteError) {
    throw new Error(`No se pudo crear la sede de fixture: ${siteError.message}`)
  }

  const { data: shift, error: shiftError } = await admin
    .from('shifts')
    .insert({
      client_id: client.id,
      site_id: site.id,
      shift_date: shiftDate,
      start_time: startTime,
      end_time: endTime,
      required_staff: 2,
    })
    .select('id')
    .single()
  if (shiftError) {
    throw new Error(
      `No se pudo crear el turno de fixture: ${shiftError.message}`,
    )
  }

  return { clientId: client.id, siteId: site.id, shiftId: shift.id, shiftDate }
}

/**
 * Asignación de fixture, creada con la RPC real `assign_employee` (no insertada directo): el
 * rol `service_role` (clave de servicio) no puede insertar en `assignments` de ninguna manera —
 * el trigger `app.sync_assignment_window` (BEFORE INSERT, `0007`) no es `security definer` y
 * `service_role` no tiene `grant usage on schema app` (`0003`, solo `authenticated` y
 * `supabase_auth_admin`), así que cualquier insert directo con la clave de servicio corta con
 * "permission denied for schema app" (mismo hallazgo que documentó
 * `tests/e2e-shifts-services/shift-manual-and-cancel.spec.ts` para P10.4). Por eso acá se arma
 * con un `actorClient` YA logueado que sí tenga permiso para llamar la RPC (el dueño, o un
 * administrador con `manage_attendance` si el turno ya empezó).
 */
export async function createFixtureAssignment(
  actorClient: TestClient,
  shiftId: string,
  employeeId: string,
): Promise<string> {
  const { data, error } = await actorClient.rpc('assign_employee', {
    p_shift_id: shiftId,
    p_employee_id: employeeId,
  })
  if (error) {
    throw new Error(
      `No se pudo crear la asignación de fixture: ${error.message}`,
    )
  }
  const payload = data as { assignment: { id: string } }
  return payload.assignment.id
}

/**
 * Libera la franja de la asignación de fixture (`remove_assignment`, con motivo): sin esto, la
 * exclusión de superposición (`assignments_no_overlap`, P-053) sigue activa entre corridas de la
 * suite -- la segunda corrida en la misma franja horaria del mismo empleado choca con
 * `ASSIGNMENT_OVERLAP` contra la asignación que dejó la corrida anterior (encontrado armando
 * esta suite, ver el reporte del encargo P11.4). Se llama ANTES de `cleanupFixtureShift`, con el
 * mismo actor que la creó (o cualquiera con permiso: `remove_assignment` es O, A).
 */
export async function removeFixtureAssignment(
  actorClient: TestClient,
  assignmentId: string,
): Promise<void> {
  await actorClient.rpc('remove_assignment', {
    p_assignment_id: assignmentId,
    p_reason: 'E2E-P114-PERM: limpieza de la asignación de fixture',
  })
}

/** Limpieza sin borrado físico: sede inactiva y cliente cerrado (mismo criterio que las suites e2e de esta fase). */
export async function cleanupFixtureShift(
  admin: TestClient,
  fixture: FixtureShift,
): Promise<void> {
  const now = new Date().toISOString()
  await admin
    .from('sites')
    .update({ status: 'inactive', deleted_at: now })
    .eq('id', fixture.siteId)
  await admin
    .from('clients')
    .update({ status: 'closed', deleted_at: now })
    .eq('id', fixture.clientId)
}
