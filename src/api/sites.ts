import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { ApiError, fromPostgrestError } from './errors'

/**
 * `src/api/sites.ts` (SITE-001, mismo patrón que `src/api/clients.ts` —
 * ver `src/api/README.md`): sedes de ADM-22, ADM-23 y ADM-24 (`06_API.md`
 * sección 5).
 *
 * Igual que `clients.ts`: sin RPC propia (`06` sección 5 dice "insert/
 * update" y "update `status`", todo directo por PostgREST, protegido por
 * `sites_write_admin`, `0012_rls_policies.sql`). Dos consecuencias, mismo
 * criterio que `clients.ts`:
 *
 * 1. `mapWriteError` traduce a mano el único código de error que documenta
 *    `06` sección 15 para este dominio (`SITE_NAME_IN_USE`, índice único
 *    `sites_client_id_name_key`); el resto de los `23505` caen en el
 *    `DUPLICATE` genérico de `fromPostgrestError`.
 * 2. `created_by`/`updated_by` no los completa un trigger (`0005_clients_
 *    sites.sql` solo dispara `app.set_updated_at`): cada función que
 *    escribe acá recibe el `profileId` de quien está logueado como
 *    parámetro.
 *
 * `fetchClientSites` (listado simple de la pestaña Sedes de ADM-21) se
 * quedó en `src/api/clients.ts` (P08.3): no se duplica acá.
 */

export type SiteStatus = Database['public']['Enums']['site_status']

/** Las dos etiquetas de `04_Modelo_de_Datos.md` sección 3. */
export const SITE_STATUS_LABELS: Record<SiteStatus, string> = {
  active: 'Activa',
  inactive: 'Inactiva',
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
    if (error.message.includes('sites_client_id_name_key')) {
      return new ApiError(
        'Ya hay una sede con ese nombre para este cliente.',
        'SITE_NAME_IN_USE',
      )
    }
    return new ApiError('Ya existe un registro con esos datos.', 'DUPLICATE')
  }
  return fromPostgrestError(error)
}

// -------------------------------------------------------------------------
// 1. Detalle (ADM-22) y formulario (ADM-23)
// -------------------------------------------------------------------------

export interface SiteDetail {
  id: string
  clientId: string
  /** Nombre del cliente dueño de la sede, para la cabecera de ADM-22 (no viene de `sites`). */
  clientName: string
  clientStatus: Database['public']['Enums']['client_status']
  name: string
  address: string
  city: string | null
  latitude: number | null
  longitude: number | null
  contactName: string | null
  contactPhone: string | null
  accessInstructions: string | null
  buildingHours: string | null
  phoneRestricted: boolean
  photosNotAllowed: boolean
  restrictionsNotes: string | null
  status: SiteStatus
  createdAt: string
  updatedAt: string | null
}

interface SiteRowWithClient {
  id: string
  client_id: string
  name: string
  address: string
  city: string | null
  latitude: number | null
  longitude: number | null
  contact_name: string | null
  contact_phone: string | null
  access_instructions: string | null
  building_hours: string | null
  phone_restricted: boolean
  photos_not_allowed: boolean
  restrictions_notes: string | null
  status: SiteStatus
  created_at: string
  updated_at: string | null
  clients: {
    legal_name: string
    trade_name: string | null
    status: Database['public']['Enums']['client_status']
  } | null
}

function mapSiteDetailRow(row: SiteRowWithClient): SiteDetail {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.clients?.trade_name ?? row.clients?.legal_name ?? '',
    clientStatus: row.clients?.status ?? 'active',
    name: row.name,
    address: row.address,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    accessInstructions: row.access_instructions,
    buildingHours: row.building_hours,
    phoneRestricted: row.phone_restricted,
    photosNotAllowed: row.photos_not_allowed,
    restrictionsNotes: row.restrictions_notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Ficha de ADM-22 (`06` sección 5: "Detalle | from('sites') + services +
 * checklist_templates de la sede"). Servicios y plantilla de tareas todavía
 * no tienen datos que traer (F10 y ADM-26, ambos fuera de este paquete): se
 * embebe `clients` para el nombre y el estado, que sí hace falta en la
 * cabecera y que `sites` no trae.
 */
export async function fetchSiteDetail(id: string): Promise<SiteDetail> {
  const { data, error } = await supabase
    .from('sites')
    .select('*, clients(legal_name, trade_name, status)')
    .eq('id', id)
    .single()

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapSiteDetailRow(data)
}

export interface SiteFormInput {
  name: string
  address: string
  city: string | null
  latitude: number | null
  longitude: number | null
  contactName: string | null
  contactPhone: string | null
  accessInstructions: string | null
  buildingHours: string | null
  phoneRestricted: boolean
  photosNotAllowed: boolean
  restrictionsNotes: string | null
  status: SiteStatus
}

/** Alta de ADM-23 (`06` sección 5: "Crear, editar | insert/update"). */
export async function createSite(
  clientId: string,
  input: SiteFormInput,
  createdBy: string,
): Promise<SiteDetail> {
  const { data, error } = await supabase
    .from('sites')
    .insert({
      client_id: clientId,
      name: input.name,
      address: input.address,
      city: input.city,
      latitude: input.latitude,
      longitude: input.longitude,
      contact_name: input.contactName,
      contact_phone: input.contactPhone,
      access_instructions: input.accessInstructions,
      building_hours: input.buildingHours,
      phone_restricted: input.phoneRestricted,
      photos_not_allowed: input.photosNotAllowed,
      restrictions_notes: input.restrictionsNotes,
      status: input.status,
      created_by: createdBy,
    })
    .select('*, clients(legal_name, trade_name, status)')
    .single()

  if (error) {
    throw mapWriteError(error)
  }
  return mapSiteDetailRow(data)
}

/** Edición de ADM-23. */
export async function updateSite(
  id: string,
  input: SiteFormInput,
  updatedBy: string,
): Promise<SiteDetail> {
  const { data, error } = await supabase
    .from('sites')
    .update({
      name: input.name,
      address: input.address,
      city: input.city,
      latitude: input.latitude,
      longitude: input.longitude,
      contact_name: input.contactName,
      contact_phone: input.contactPhone,
      access_instructions: input.accessInstructions,
      building_hours: input.buildingHours,
      phone_restricted: input.phoneRestricted,
      photos_not_allowed: input.photosNotAllowed,
      restrictions_notes: input.restrictionsNotes,
      status: input.status,
      updated_by: updatedBy,
    })
    .eq('id', id)
    .select('*, clients(legal_name, trade_name, status)')
    .single()

  if (error) {
    throw mapWriteError(error)
  }
  return mapSiteDetailRow(data)
}

/**
 * SITE-006: cambio de estado desde ADM-22 (`06` sección 5: "Cambiar estado
 * | update `status`"). Aparte de `updateSite` porque esta acción no pasa
 * por el formulario completo: solo toca `status`.
 */
export async function setSiteStatus(
  id: string,
  status: SiteStatus,
  updatedBy: string,
): Promise<SiteDetail> {
  const { data, error } = await supabase
    .from('sites')
    .update({ status, updated_by: updatedBy })
    .eq('id', id)
    .select('*, clients(legal_name, trade_name, status)')
    .single()

  if (error) {
    throw mapWriteError(error)
  }
  return mapSiteDetailRow(data)
}

// -------------------------------------------------------------------------
// 2. Mapa de sedes (ADM-24, pestaña "Mapa" de ADM-19)
// -------------------------------------------------------------------------

export interface SiteMapRow {
  id: string
  name: string
  address: string
  city: string | null
  latitude: number | null
  longitude: number | null
  status: SiteStatus
  clientId: string
  clientName: string
}

export interface SiteMapFilters {
  clientId?: string
}

/**
 * Sedes vigentes para el mapa de ADM-24 (`06` sección 4: "Mapa |
 * from('sites').select(...).not('latitude','is',null)"). A diferencia de la
 * consulta que sugiere `06`, acá se traen también las sedes sin coordenadas
 * (el filtro `latitude not null` se aplica en el cliente): la pantalla
 * necesita el total para avisar "n sedes sin ubicación" (SITE-005), no solo
 * las que sí se pueden dibujar.
 */
export async function fetchSitesForMap(
  filters: SiteMapFilters = {},
): Promise<SiteMapRow[]> {
  let query = supabase
    .from('sites')
    .select(
      'id, name, address, city, latitude, longitude, status, client_id, clients(legal_name, trade_name)',
    )
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (filters.clientId) {
    query = query.eq('client_id', filters.clientId)
  }

  const { data, error } = await query
  if (error) {
    throw fromPostgrestError(error)
  }

  return (data ?? []).map((row) => {
    const client = row.clients
    return {
      id: row.id,
      name: row.name,
      address: row.address,
      city: row.city,
      latitude: row.latitude,
      longitude: row.longitude,
      status: row.status,
      clientId: row.client_id,
      clientName: client?.trade_name ?? client?.legal_name ?? '',
    }
  })
}

export interface ClientFilterOption {
  id: string
  name: string
}

/** Opciones del filtro "Cliente" del mapa de sedes (ADM-24). */
export async function fetchClientFilterOptions(): Promise<
  ClientFilterOption[]
> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, legal_name, trade_name')
    .is('deleted_at', null)
    .order('legal_name', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.trade_name ?? row.legal_name,
  }))
}
