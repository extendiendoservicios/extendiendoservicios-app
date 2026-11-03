import { supabase } from '@/lib/supabase'
import { fromPostgrestError } from './errors'

/**
 * `src/api/clientCategories.ts` (P27.7, OD-20): categorías de clientes. La
 * lista la editan el dueño y los administradores desde Configuración; la
 * escritura va por RPC (`upsert_client_category`, `reorder_client_categories`,
 * `remove_client_category`). Errores: `NAME_REQUIRED`, `NAME_TOO_LONG`,
 * `CATEGORY_NOT_FOUND`, `CATEGORY_NAME_TAKEN`.
 */

export interface ClientCategory {
  id: string
  name: string
  sortOrder: number
}

interface CategoryRow {
  id: string
  name: string
  sort_order: number
}

function mapRow(row: CategoryRow): ClientCategory {
  return { id: row.id, name: row.name, sortOrder: row.sort_order }
}

/** Categorías vigentes, en el orden que eligió la empresa. */
export async function fetchClientCategories(): Promise<ClientCategory[]> {
  const { data, error } = await supabase
    .from('client_categories')
    .select('id, name, sort_order')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map(mapRow)
}

/** Cuántos clientes tiene cada categoría (para avisar antes de darla de baja). */
export async function fetchClientCountsByCategory(): Promise<
  Map<string, number>
> {
  const { data, error } = await supabase
    .from('clients')
    .select('category_id')
    .not('category_id', 'is', null)
    .is('deleted_at', null)

  if (error) {
    throw fromPostgrestError(error)
  }
  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    if (row.category_id) {
      counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1)
    }
  }
  return counts
}

/** Alta: queda al final. */
export async function createClientCategory(
  name: string,
): Promise<ClientCategory> {
  const { data, error } = await supabase.rpc('upsert_client_category', {
    p_name: name,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return mapRow(data)
}

/** Cambio de nombre. */
export async function renameClientCategory(
  id: string,
  name: string,
): Promise<ClientCategory> {
  const { data, error } = await supabase.rpc('upsert_client_category', {
    p_name: name,
    p_id: id,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return mapRow(data)
}

/** El orden pasa a ser el de la lista. */
export async function reorderClientCategories(
  ids: string[],
): Promise<ClientCategory[]> {
  const { data, error } = await supabase.rpc('reorder_client_categories', {
    p_ids: ids,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map(mapRow)
}

/** Baja lógica: devuelve cuántos clientes quedaron sin categoría. */
export async function removeClientCategory(id: string): Promise<number> {
  const { data, error } = await supabase.rpc('remove_client_category', {
    p_id: id,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data as unknown as { clients_cleared: number }).clients_cleared ?? 0
}
