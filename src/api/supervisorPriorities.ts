import { supabase } from '@/lib/supabase'
import { fromPostgrestError } from './errors'

/**
 * `src/api/supervisorPriorities.ts` (P24.3, CJ-03 y CJ-24): clientes y sedes
 * preferenciales de cada coordinador. Sirven para ordenar la lista del
 * coordinador, no para restringir. Una prioridad es de un cliente entero
 * (cubre todas sus sedes, también las que se creen después) o de una sede.
 *
 * Lectura: `supervisor_priorities` (dueño y administradores leen todo; baja
 * lógica con `removed_at`). Escritura: `set_supervisor_priority` y
 * `remove_supervisor_priority` (O, A + `manage_supervisions`). Los errores
 * ya traen `message` en voseo y `hint` (`INVALID_PRIORITY_TARGET`,
 * `SUPERVISOR_ROLE_REQUIRED`, `CLIENT_NOT_FOUND`, `SITE_NOT_FOUND`,
 * `PRIORITY_ALREADY_EXISTS`, `PRIORITY_NOT_FOUND`,
 * `PRIORITY_ALREADY_REMOVED`): `fromPostgrestError` los deja pasar tal cual.
 */

export interface SupervisorPriority {
  id: string
  supervisorId: string
  supervisorName: string
  /** `client`: todo el cliente; `site`: una sede. */
  kind: 'client' | 'site'
  clientId: string
  clientName: string
  siteId: string | null
  siteName: string | null
  createdAt: string
}

interface PriorityRawRow {
  id: string
  supervisor_id: string
  client_id: string | null
  site_id: string | null
  created_at: string
  employees: {
    profiles: { first_name: string; last_name: string } | null
  } | null
  client: { legal_name: string; trade_name: string | null } | null
  site: {
    name: string
    client_id: string
    clients: { legal_name: string; trade_name: string | null } | null
  } | null
}

const PRIORITY_SELECT = `
  id, supervisor_id, client_id, site_id, created_at,
  employees(profiles!employees_profile_id_fkey(first_name, last_name)),
  client:clients(legal_name, trade_name),
  site:sites(name, client_id, clients(legal_name, trade_name))
`

function clientLabel(client: {
  legal_name: string
  trade_name: string | null
}): string {
  return client.trade_name ?? client.legal_name
}

export function mapPriorityRow(row: PriorityRawRow): SupervisorPriority {
  const isSite = row.site_id != null
  const clientId = isSite ? (row.site?.client_id ?? '') : (row.client_id ?? '')
  const clientSource = isSite ? row.site?.clients : row.client
  const profile = row.employees?.profiles
  return {
    id: row.id,
    supervisorId: row.supervisor_id,
    supervisorName: profile ? `${profile.first_name} ${profile.last_name}` : '',
    kind: isSite ? 'site' : 'client',
    clientId,
    clientName: clientSource ? clientLabel(clientSource) : '',
    siteId: row.site_id,
    siteName: row.site?.name ?? null,
    createdAt: row.created_at,
  }
}

/**
 * Todas las prioridades vigentes (sin baja). Son pocas (un puñado por
 * coordinador), así que una sola consulta alimenta la ficha del
 * coordinador, la del cliente y la de la sede, que filtran en el cliente
 * (`src/features/supervisions/priorities.ts`).
 */
export async function fetchSupervisorPriorities(): Promise<
  SupervisorPriority[]
> {
  const { data, error } = await supabase
    .from('supervisor_priorities')
    .select(PRIORITY_SELECT)
    .is('removed_at', null)
    .order('created_at', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return ((data ?? []) as unknown as PriorityRawRow[]).map(mapPriorityRow)
}

/** Una sede para el selector de «Agregar» de la ficha del coordinador. */
export interface SiteOption {
  id: string
  name: string
  clientId: string
  clientName: string
}

/** Sedes no dadas de baja, con el nombre de su cliente, ordenadas por cliente y sede. */
export async function fetchSiteOptions(): Promise<SiteOption[]> {
  const { data, error } = await supabase
    .from('sites')
    .select('id, name, client_id, clients(legal_name, trade_name)')
    .is('deleted_at', null)

  if (error) {
    throw fromPostgrestError(error)
  }
  const rows = (data ?? []) as unknown as {
    id: string
    name: string
    client_id: string
    clients: { legal_name: string; trade_name: string | null } | null
  }[]
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      clientId: row.client_id,
      clientName: row.clients ? clientLabel(row.clients) : '',
    }))
    .sort(
      (a, b) =>
        a.clientName.localeCompare(b.clientName, 'es') ||
        a.name.localeCompare(b.name, 'es'),
    )
}

/** `set_supervisor_priority`: exactamente uno de `clientId` y `siteId`. */
export async function setSupervisorPriority(input: {
  supervisorId: string
  clientId?: string
  siteId?: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('set_supervisor_priority', {
    p_supervisor_id: input.supervisorId,
    p_client_id: input.clientId,
    p_site_id: input.siteId,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return data.id
}

/** `remove_supervisor_priority`: baja lógica (`removed_at`, sin borrado físico). */
export async function removeSupervisorPriority(
  priorityId: string,
): Promise<void> {
  const { error } = await supabase.rpc('remove_supervisor_priority', {
    p_priority_id: priorityId,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
}
