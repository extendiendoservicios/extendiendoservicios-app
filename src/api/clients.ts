import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { ApiError, fromPostgrestError } from './errors'

/**
 * `src/api/clients.ts` (CLIENT-001, patrón fijado en `src/api/users.ts` —
 * ver `src/api/README.md`): clientes y contactos de ADM-19, ADM-20 y
 * ADM-21 (`06_API.md` sección 4).
 *
 * Igual que `settings.ts` (no `users.ts`): acá tampoco hay una RPC propia
 * (`06` sección 4 dice "insert/update", "update `status`",
 * "insert/update/delete lógico en `client_contacts`" — todo directo por
 * PostgREST, protegido por `clients_write_admin`/`client_contacts_write_admin`,
 * `0012_rls_policies.sql`). Dos consecuencias, mismo criterio que
 * `settings.ts`:
 *
 * 1. `mapWriteError` traduce a mano el único código de error que documenta
 *    `06` sección 15 para este dominio (`CUIT_IN_USE`, restricción
 *    `clients.cuit unique`); el resto de los `23505` (por ejemplo, dos
 *    contactos principales del mismo cliente — no debería pasar, ver
 *    `setPrimaryClientContact`) caen en el `DUPLICATE` genérico de
 *    `fromPostgrestError`.
 * 2. `created_by`/`updated_by` no los completa un trigger (`0005_clients_
 *    sites.sql` solo dispara `app.set_updated_at`, que toca `updated_at`):
 *    cada función que escribe acá recibe el `profileId` de quien está
 *    logueado como parámetro.
 */

export type ClientStatus = Database['public']['Enums']['client_status']

/** Las tres etiquetas de `04_Modelo_de_Datos.md` sección 3. */
export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active: 'Activo',
  suspended: 'Suspendido',
  closed: 'Baja',
}

// -------------------------------------------------------------------------
// Errores de escritura directa a tabla (sin RPC, ver comentario de arriba)
// -------------------------------------------------------------------------

function mapWriteError(error: {
  code?: string | null
  message: string
  hint?: string | null
}): ApiError {
  if (error.code === '23505') {
    if (error.message.includes('cuit')) {
      return new ApiError('Ese CUIT ya está registrado.', 'CUIT_IN_USE')
    }
    return new ApiError('Ya existe un registro con esos datos.', 'DUPLICATE')
  }
  return fromPostgrestError(error)
}

// -------------------------------------------------------------------------
// 1. Listado (ADM-19, `v_clients`)
// -------------------------------------------------------------------------

/** Una fila del listado de ADM-19 (`v_clients`, `06` sección 4). */
export interface ClientListRow {
  id: string
  legalName: string
  tradeName: string | null
  cuit: string | null
  status: ClientStatus
  sitesCount: number
  activeServicesCount: number
}

export interface ClientListFilters {
  /** Busca en razón social, fantasía y CUIT. */
  text?: string
  status?: ClientStatus | 'all'
}

/**
 * Lista de clientes con conteo de sedes y servicios activos (`06` sección
 * 4: "Listar | from('clients') con conteo de sedes y servicios activos
 * (vista v_clients)"). Siempre filtra `deleted_at is null`: ningún flujo de
 * `front-admin` da de baja físicamente un cliente (la baja es `status =
 * 'closed'`, CLIENT-006) — `deleted_at` queda para el caso, hoy sin
 * pantalla propia, de corregir un alta hecha por error.
 */
export async function fetchClients(
  filters: ClientListFilters = {},
): Promise<ClientListRow[]> {
  let query = supabase
    .from('v_clients')
    .select(
      'id, legal_name, trade_name, cuit, status, sites_count, active_services_count',
    )
    .is('deleted_at', null)
    .order('legal_name', { ascending: true })

  const text = filters.text?.trim()
  if (text) {
    const escaped = text.replace(/[%_]/g, '\\$&')
    query = query.or(
      `legal_name.ilike.%${escaped}%,trade_name.ilike.%${escaped}%,cuit.ilike.%${escaped}%`,
    )
  }
  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }

  const { data, error } = await query
  if (error) {
    throw fromPostgrestError(error)
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    legalName: row.legal_name as string,
    tradeName: row.trade_name,
    cuit: row.cuit,
    status: row.status as ClientStatus,
    sitesCount: row.sites_count ?? 0,
    activeServicesCount: row.active_services_count ?? 0,
  }))
}

/**
 * Contacto principal de cada cliente (columna "contacto principal" de
 * ADM-19, `05` línea 73). `v_clients` no lo trae (06 sección 4 lo separa en
 * la fila de "Contactos"): se arma acá con el mismo criterio que
 * `fetchLastSignIns` en `users.ts` — una consulta aparte, mapeada por
 * `client_id`, que la pantalla combina con `fetchClients` en memoria.
 */
export async function fetchPrimaryContactNames(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('client_contacts')
    .select('client_id, name')
    .eq('is_primary', true)
    .is('deleted_at', null)

  if (error) {
    throw fromPostgrestError(error)
  }

  const namesByClientId = new Map<string, string>()
  for (const row of data ?? []) {
    namesByClientId.set(row.client_id, row.name)
  }
  return namesByClientId
}

// -------------------------------------------------------------------------
// 2. Detalle y formulario (ADM-20, ADM-21)
// -------------------------------------------------------------------------

export interface ClientDetail {
  id: string
  legalName: string
  tradeName: string | null
  cuit: string | null
  adminAddress: string | null
  latitude: number | null
  longitude: number | null
  status: ClientStatus
  notes: string | null
  createdAt: string
  updatedAt: string | null
}

function mapClientRow(
  row: Database['public']['Tables']['clients']['Row'],
): ClientDetail {
  return {
    id: row.id,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    cuit: row.cuit,
    adminAddress: row.admin_address,
    latitude: row.latitude,
    longitude: row.longitude,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Ficha de ADM-21 (`06` sección 4: "Detalle | from('clients') + …"). */
export async function fetchClientDetail(id: string): Promise<ClientDetail> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapClientRow(data)
}

export interface ClientFormInput {
  legalName: string
  /** `null` borra el dato (cadena vacía del formulario ya normalizada por `schemas.ts`). */
  tradeName: string | null
  cuit: string | null
  adminAddress: string | null
  latitude: number | null
  longitude: number | null
  status: ClientStatus
  notes: string | null
}

/** Alta de ADM-20 (`06` sección 4: "Crear, editar | insert/update"). */
export async function createClient(
  input: ClientFormInput,
  createdBy: string,
): Promise<ClientDetail> {
  const { data, error } = await supabase
    .from('clients')
    .insert({
      legal_name: input.legalName,
      trade_name: input.tradeName,
      cuit: input.cuit,
      admin_address: input.adminAddress,
      latitude: input.latitude,
      longitude: input.longitude,
      status: input.status,
      notes: input.notes,
      created_by: createdBy,
    })
    .select('*')
    .single()

  if (error) {
    throw mapWriteError(error)
  }
  return mapClientRow(data)
}

/** Edición de ADM-20. */
export async function updateClient(
  id: string,
  input: ClientFormInput,
  updatedBy: string,
): Promise<ClientDetail> {
  const { data, error } = await supabase
    .from('clients')
    .update({
      legal_name: input.legalName,
      trade_name: input.tradeName,
      cuit: input.cuit,
      admin_address: input.adminAddress,
      latitude: input.latitude,
      longitude: input.longitude,
      status: input.status,
      notes: input.notes,
      updated_by: updatedBy,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw mapWriteError(error)
  }
  return mapClientRow(data)
}

/**
 * CLIENT-006: cambio de estado desde ADM-21 (`06` sección 4: "Cambiar
 * estado | update `status`"). Aparte de `updateClient` porque esta acción
 * no pasa por el formulario completo: solo toca `status`.
 */
export async function setClientStatus(
  id: string,
  status: ClientStatus,
  updatedBy: string,
): Promise<ClientDetail> {
  const { data, error } = await supabase
    .from('clients')
    .update({ status, updated_by: updatedBy })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw mapWriteError(error)
  }
  return mapClientRow(data)
}

// -------------------------------------------------------------------------
// 3. Contactos (CLIENT-005)
// -------------------------------------------------------------------------

export interface ClientContact {
  id: string
  clientId: string
  name: string
  roleTitle: string | null
  phone: string | null
  email: string | null
  isPrimary: boolean
}

function mapContactRow(
  row: Database['public']['Tables']['client_contacts']['Row'],
): ClientContact {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    roleTitle: row.role_title,
    phone: row.phone,
    email: row.email,
    isPrimary: row.is_primary,
  }
}

/** Contactos vigentes de un cliente, principal primero. */
export async function fetchClientContacts(
  clientId: string,
): Promise<ClientContact[]> {
  const { data, error } = await supabase
    .from('client_contacts')
    .select('*')
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('is_primary', { ascending: false })
    .order('name', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map(mapContactRow)
}

export interface ClientContactInput {
  name: string
  roleTitle: string | null
  phone: string | null
  email: string | null
  /**
   * Si viene en `true`, la pantalla ya se ocupó de sacarle el principal al
   * contacto anterior (`setPrimaryClientContact`, dos pasos porque el
   * índice único parcial `client_contacts_one_primary_per_client_idx` no
   * admite dos filas en `true` a la vez ni siquiera dentro de la misma
   * sentencia) antes de crear o editar este con `true`.
   */
  isPrimary: boolean
}

/** Alta de un contacto (CLIENT-005). El primer contacto de un cliente conviene marcarlo principal desde la pantalla, no acá. */
export async function createClientContact(
  clientId: string,
  input: ClientContactInput,
  createdBy: string,
): Promise<ClientContact> {
  const { data, error } = await supabase
    .from('client_contacts')
    .insert({
      client_id: clientId,
      name: input.name,
      role_title: input.roleTitle,
      phone: input.phone,
      email: input.email,
      is_primary: input.isPrimary,
      created_by: createdBy,
    })
    .select('*')
    .single()

  if (error) {
    throw mapWriteError(error)
  }
  return mapContactRow(data)
}

/** Edición de un contacto (sin tocar `is_primary`, ver `setPrimaryClientContact`). */
export async function updateClientContact(
  id: string,
  input: Omit<ClientContactInput, 'isPrimary'>,
  updatedBy: string,
): Promise<ClientContact> {
  const { data, error } = await supabase
    .from('client_contacts')
    .update({
      name: input.name,
      role_title: input.roleTitle,
      phone: input.phone,
      email: input.email,
      updated_by: updatedBy,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw mapWriteError(error)
  }
  return mapContactRow(data)
}

/**
 * Marca `contactId` como principal del cliente y le saca la marca al que
 * la tuviera antes (`06` sección 4: "Un principal por cliente"). Dos
 * `update` secuenciales, no una transacción: no hay RPC para esto (ver el
 * comentario de cabecera) y el índice único parcial rechaza tener dos filas
 * en `true` a la vez, así que primero hay que soltar la anterior. Si el
 * segundo paso fallara después de que el primero ya corrió, el cliente
 * queda un instante sin principal — se prefiere eso a bloquear la acción
 * con una función nueva que el backend no construyó para este paquete (ver
 * el reporte del encargo).
 */
export async function setPrimaryClientContact(
  clientId: string,
  contactId: string,
  updatedBy: string,
): Promise<void> {
  const { error: unsetError } = await supabase
    .from('client_contacts')
    .update({ is_primary: false, updated_by: updatedBy })
    .eq('client_id', clientId)
    .eq('is_primary', true)
    .neq('id', contactId)

  if (unsetError) {
    throw mapWriteError(unsetError)
  }

  const { error: setError } = await supabase
    .from('client_contacts')
    .update({ is_primary: true, updated_by: updatedBy })
    .eq('id', contactId)

  if (setError) {
    throw mapWriteError(setError)
  }
}

/** Baja lógica de un contacto (CLIENT-005). */
export async function deactivateClientContact(
  id: string,
  updatedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('client_contacts')
    .update({ deleted_at: new Date().toISOString(), updated_by: updatedBy })
    .eq('id', id)

  if (error) {
    throw mapWriteError(error)
  }
}

// -------------------------------------------------------------------------
// 4. Sedes del cliente (pestaña "Sedes" de ADM-21 — el listado simple; el
//    alta y el detalle de sede son de SITE-001 a SITE-003, P08.4)
// -------------------------------------------------------------------------

export interface ClientSiteRow {
  id: string
  name: string
  address: string
  city: string | null
  status: Database['public']['Enums']['site_status']
}

/** Sedes vigentes de un cliente, para la pestaña Sedes de ADM-21. */
export async function fetchClientSites(
  clientId: string,
): Promise<ClientSiteRow[]> {
  const { data, error } = await supabase
    .from('sites')
    .select('id, name, address, city, status')
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    address: row.address,
    city: row.city,
    status: row.status,
  }))
}
