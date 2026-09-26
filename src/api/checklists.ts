import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { ApiError, fromPostgrestError } from './errors'

/**
 * `src/api/checklists.ts` (TASK-003, mismo patrón que `src/api/clients.ts`
 * -- ver `src/api/README.md`): plantillas de tareas por cliente y por sede
 * de ADM-26, ADM-21 y ADM-22 (`06_API.md` sección 9).
 *
 * Igual que `clients.ts`: la lectura y edición de `checklist_templates` y
 * `checklist_template_items` es directa por PostgREST (RLS `O, A +
 * edit_checklists`, `0012_rls_policies.sql`); la única RPC del dominio para
 * este módulo es `clone_checklist_template` (crea la plantilla propia de
 * una sede copiando los ítems de la del cliente, P-058). `update_task_status`
 * y `reload_shift_tasks` -- las tareas YA COPIADAS a un turno -- viven en
 * `src/api/tasks.ts`, no acá.
 *
 * `created_by`/`updated_by` no los completa ningún trigger
 * (`0008_checklists_tasks.sql` solo dispara `app.set_updated_at`): cada
 * función que escribe acá recibe el `actorId` de quien está logueado.
 */

// -------------------------------------------------------------------------
// Errores de escritura directa a tabla (sin RPC, ver comentario de arriba)
// -------------------------------------------------------------------------

function mapWriteError(error: {
  code?: string | null
  message: string
  hint?: string | null
}): ApiError {
  if (error.code === '23505') {
    return new ApiError(
      'Ya existe una plantilla para este cliente o esta sede.',
      'TEMPLATE_EXISTS',
    )
  }
  return fromPostgrestError(error)
}

// -------------------------------------------------------------------------
// 1. Plantillas (`checklist_templates`)
// -------------------------------------------------------------------------

export interface ChecklistTemplate {
  id: string
  clientId: string
  siteId: string | null
  name: string
  isActive: boolean
}

function mapTemplateRow(
  row: Database['public']['Tables']['checklist_templates']['Row'],
): ChecklistTemplate {
  return {
    id: row.id,
    clientId: row.client_id,
    siteId: row.site_id,
    name: row.name,
    isActive: row.is_active,
  }
}

/**
 * La plantilla vigente de un cliente (`siteId` `null`) o de una sede
 * puntual (`06` sección 9: "Plantillas por cliente | ... | O, A"). `null`
 * si todavía no existe -- no es un error: ADM-21, ADM-22 y ADM-26 lo
 * muestran como "usa la del cliente" o "todavía no tiene plantilla".
 */
export async function fetchChecklistTemplate(
  clientId: string,
  siteId: string | null,
): Promise<ChecklistTemplate | null> {
  let query = supabase
    .from('checklist_templates')
    .select('*')
    .eq('client_id', clientId)
    .is('deleted_at', null)

  query = siteId ? query.eq('site_id', siteId) : query.is('site_id', null)

  const { data, error } = await query.maybeSingle()
  if (error) {
    throw fromPostgrestError(error)
  }
  return data ? mapTemplateRow(data) : null
}

/**
 * Crea la plantilla de un cliente (sin sede). Nombre fijo, sin pedirlo en
 * un formulario aparte (decisión propia, ver el reporte del encargo):
 * mismo criterio que `clone_checklist_template` en el servidor, que copia
 * el nombre de la plantilla del cliente tal cual, sin pedir uno nuevo.
 */
export async function createClientTemplate(
  clientId: string,
  createdBy: string,
): Promise<ChecklistTemplate> {
  const { data, error } = await supabase
    .from('checklist_templates')
    .insert({
      client_id: clientId,
      site_id: null,
      name: 'Plantilla de tareas',
      created_by: createdBy,
    })
    .select('*')
    .single()

  if (error) {
    throw mapWriteError(error)
  }
  return mapTemplateRow(data)
}

/**
 * Crea la plantilla propia de una sede, copiando los ítems de la del
 * cliente (`06` sección 9: `clone_checklist_template`, P-058). Errores:
 * `CLIENT_NOT_ACTIVE`, `SITE_NOT_ACTIVE`, `SITE_TEMPLATE_EXISTS`,
 * `CLIENT_TEMPLATE_NOT_FOUND` (ya en voseo, se muestran tal cual).
 */
export async function cloneChecklistTemplate(
  clientId: string,
  siteId: string,
): Promise<ChecklistTemplate> {
  const { data, error } = await supabase.rpc('clone_checklist_template', {
    p_client_id: clientId,
    p_site_id: siteId,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapTemplateRow(data)
}

// -------------------------------------------------------------------------
// 2. Ítems (`checklist_template_items`)
// -------------------------------------------------------------------------

export interface ChecklistTemplateItem {
  id: string
  templateId: string
  position: number
  title: string
  description: string | null
  isRequired: boolean
}

function mapItemRow(
  row: Database['public']['Tables']['checklist_template_items']['Row'],
): ChecklistTemplateItem {
  return {
    id: row.id,
    templateId: row.template_id,
    position: row.position,
    title: row.title,
    description: row.description,
    isRequired: row.is_required,
  }
}

/** Ítems vigentes de una plantilla, en orden (ADM-26: "lista ordenable"). */
export async function fetchTemplateItems(
  templateId: string,
): Promise<ChecklistTemplateItem[]> {
  const { data, error } = await supabase
    .from('checklist_template_items')
    .select('*')
    .eq('template_id', templateId)
    .is('deleted_at', null)
    .order('position', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map(mapItemRow)
}

export interface ChecklistItemInput {
  title: string
  description: string | null
  isRequired: boolean
}

/** Alta de un ítem, al final de la lista (`position` la calcula quien llama). */
export async function createTemplateItem(
  templateId: string,
  position: number,
  input: ChecklistItemInput,
  createdBy: string,
): Promise<ChecklistTemplateItem> {
  const { data, error } = await supabase
    .from('checklist_template_items')
    .insert({
      template_id: templateId,
      position,
      title: input.title,
      description: input.description,
      is_required: input.isRequired,
      created_by: createdBy,
    })
    .select('*')
    .single()

  if (error) {
    throw mapWriteError(error)
  }
  return mapItemRow(data)
}

/** Edición de un ítem (título, descripción, obligatoria/opcional). Sin tocar `position` (ver `reorderTemplateItems`). */
export async function updateTemplateItem(
  id: string,
  input: ChecklistItemInput,
  updatedBy: string,
): Promise<ChecklistTemplateItem> {
  const { data, error } = await supabase
    .from('checklist_template_items')
    .update({
      title: input.title,
      description: input.description,
      is_required: input.isRequired,
      updated_by: updatedBy,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw mapWriteError(error)
  }
  return mapItemRow(data)
}

/** Baja lógica de un ítem (ADM-26: "con confirmación", sin motivo obligatorio -- no está en la lista de `07` sección 2.4 que sí lo exige). */
export async function deactivateTemplateItem(
  id: string,
  updatedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('checklist_template_items')
    .update({ deleted_at: new Date().toISOString(), updated_by: updatedBy })
    .eq('id', id)

  if (error) {
    throw mapWriteError(error)
  }
}

/**
 * Reordena los ítems (`06` sección 9: "Reordenar: update de `position` en
 * lote"). Un solo `upsert` con todas las filas -- no varios `update`
 * sueltos: `checklist_template_items_template_id_position_key` es
 * `deferrable initially deferred` (`0008_checklists_tasks.sql`), así que
 * solo queda diferida (y permite un intercambio de posiciones sin chocar)
 * dentro de la MISMA transacción; PostgREST abre una transacción por
 * request, así que varios `update` de a uno (uno por request) la
 * verificarían de a uno igual y un intercambio simple ya rompería. Se manda
 * la fila completa (no solo `id`/`position`) para no depender de qué pasa
 * con las columnas `not null` omitidas en la rama de inserción del
 * `upsert` cuando en la práctica nunca se llega a insertar (el `id` ya
 * existe siempre).
 */
export async function reorderTemplateItems(
  items: ChecklistTemplateItem[],
  updatedBy: string,
): Promise<void> {
  const { error } = await supabase.from('checklist_template_items').upsert(
    items.map((item, index) => ({
      id: item.id,
      template_id: item.templateId,
      position: index,
      title: item.title,
      description: item.description,
      is_required: item.isRequired,
      updated_by: updatedBy,
    })),
    { onConflict: 'id' },
  )

  if (error) {
    throw mapWriteError(error)
  }
}
