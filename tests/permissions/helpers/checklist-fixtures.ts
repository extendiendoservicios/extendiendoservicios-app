// tests/permissions/helpers/checklist-fixtures.ts — TASK-008/TEST-009 (P12.3,
// 08_Fases_y_Backlog.md F12 "Checklists y tareas")
//
// Fixtures mínimas para probar `checklist_templates`/`checklist_template_items`,
// `clone_checklist_template`, `update_task_status` y `reload_shift_tasks` por API directa. Mismo
// criterio que `assignment-fixtures.ts` (P11.4): un cliente y dos sedes propios y descartables; una
// tarea de turno (`shift_tasks`) insertada directo con la clave de servicio -- alcanza con una
// fila para probar el cambio de estado, no hace falta pasar por una plantilla real ni por
// `create_shift`.

import type { TestClient } from './clients.ts'

export const CHECKLIST_PERMISSIONS_NAME_PREFIX = 'E2E-P123-PERM'

export interface FixtureChecklistClient {
  clientId: string
  /** Sede sin plantilla propia: destino de los intentos de alta que deberían fallar. */
  siteWithoutTemplateId: string
  /** Segunda sede, reservada para `clone_checklist_template` (positivo y negativo). */
  siteForCloneId: string
}

/** Cliente y dos sedes de fixture, sin ninguna plantilla todavía (cada test crea la que necesita). */
export async function createFixtureChecklistClient(
  admin: TestClient,
): Promise<FixtureChecklistClient> {
  const suffix = Date.now()
  const { data: client, error: clientError } = await admin
    .from('clients')
    .insert({
      legal_name: `${CHECKLIST_PERMISSIONS_NAME_PREFIX} Cliente ${suffix}`,
      cuit: `20${String(suffix).slice(-8)}2`,
      status: 'active',
    })
    .select('id')
    .single()
  if (clientError) {
    throw new Error(
      `No se pudo crear el cliente de fixture: ${clientError.message}`,
    )
  }

  const { data: siteA, error: siteAError } = await admin
    .from('sites')
    .insert({
      client_id: client.id,
      name: `${CHECKLIST_PERMISSIONS_NAME_PREFIX} Sede A ${suffix}`,
      address: 'Dirección de prueba, sin importancia',
      status: 'active',
    })
    .select('id')
    .single()
  if (siteAError) {
    throw new Error(
      `No se pudo crear la sede de fixture: ${siteAError.message}`,
    )
  }

  const { data: siteB, error: siteBError } = await admin
    .from('sites')
    .insert({
      client_id: client.id,
      name: `${CHECKLIST_PERMISSIONS_NAME_PREFIX} Sede B ${suffix}`,
      address: 'Dirección de prueba, sin importancia',
      status: 'active',
    })
    .select('id')
    .single()
  if (siteBError) {
    throw new Error(
      `No se pudo crear la segunda sede de fixture: ${siteBError.message}`,
    )
  }

  return {
    clientId: client.id,
    siteWithoutTemplateId: siteA.id,
    siteForCloneId: siteB.id,
  }
}

/** Limpieza sin borrado físico: plantillas e ítems de baja lógica, sedes inactivas, cliente cerrado. */
export async function cleanupFixtureChecklistClient(
  admin: TestClient,
  fixture: FixtureChecklistClient,
): Promise<void> {
  const now = new Date().toISOString()
  const { data: templates } = await admin
    .from('checklist_templates')
    .select('id')
    .eq('client_id', fixture.clientId)
    .is('deleted_at', null)
  const templateIds = (templates ?? []).map((t) => t.id)

  if (templateIds.length > 0) {
    await admin
      .from('checklist_template_items')
      .update({ deleted_at: now })
      .in('template_id', templateIds)
      .is('deleted_at', null)
    await admin
      .from('checklist_templates')
      .update({ deleted_at: now, is_active: false })
      .in('id', templateIds)
  }

  await admin
    .from('sites')
    .update({ status: 'inactive', deleted_at: now })
    .eq('client_id', fixture.clientId)
  await admin
    .from('clients')
    .update({ status: 'closed', deleted_at: now })
    .eq('id', fixture.clientId)
}

/**
 * Tarea de fixture insertada directo (sin pasar por una plantilla real ni por `create_shift`):
 * alcanza con una fila para probar `update_task_status`, que solo mira `shift_tasks`/`assignments`.
 */
export async function createFixtureShiftTask(
  admin: TestClient,
  shiftId: string,
  titleSuffix: string,
): Promise<string> {
  const { data, error } = await admin
    .from('shift_tasks')
    .insert({
      shift_id: shiftId,
      position: 0,
      title: `${CHECKLIST_PERMISSIONS_NAME_PREFIX} tarea ${titleSuffix}`,
      is_required: true,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error) {
    throw new Error(`No se pudo crear la tarea de fixture: ${error.message}`)
  }
  return data.id
}

/** Borrado físico: `shift_tasks` no tiene baja lógica en el modelo (04 sección 2.4: solo `status`). */
export async function deleteFixtureShiftTask(
  admin: TestClient,
  taskId: string,
): Promise<void> {
  await admin.from('shift_tasks').delete().eq('id', taskId)
}
