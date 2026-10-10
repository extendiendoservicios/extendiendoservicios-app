import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { fromPostgrestError } from './errors'

/**
 * `src/api/announcements.ts` (AJ2-03, paquete E, migración
 * `0042_p19_6e_avisos_y_anuncios.sql`): «Avisos y anuncios» de
 * ADMINISTRACIÓN. No tiene relación con `notices.ts` (avisos de demora y
 * ausencia del empleado). Lo que ve y cierra la persona en el celular vive
 * en `myAnnouncements.ts` (paquete móvil).
 *
 * Lecturas por las vistas `v_announcements_admin` y `v_announcement_recipients`
 * (vacías para quien no es dueño o administrador) y escrituras por las RPC
 * `create_announcement`, `update_announcement` y `archive_announcement`. Las
 * RPC devuelven `message` en español y un `hint` estable: alcanza con
 * `fromPostgrestError`.
 */

export type AnnouncementAudience =
  Database['public']['Enums']['announcement_audience']

export type AnnouncementStatus = 'active' | 'expired' | 'archived'

/** Códigos `hint` posibles (guía para quien arma la pantalla). */
export type AnnouncementErrorHint =
  | 'TITLE_REQUIRED'
  | 'TITLE_TOO_LONG'
  | 'BODY_REQUIRED'
  | 'BODY_TOO_LONG'
  | 'AUDIENCE_REQUIRED'
  | 'VISIBLE_UNTIL_IN_PAST'
  | 'RECIPIENTS_REQUIRED'
  | 'RECIPIENT_INVALID'
  | 'ANNOUNCEMENT_NOT_FOUND'
  | 'ANNOUNCEMENT_ARCHIVED'
  | 'FORBIDDEN'

export const ANNOUNCEMENT_TITLE_MAX = 120
export const ANNOUNCEMENT_BODY_MAX = 2000

export const ANNOUNCEMENT_STATUS_LABELS: Record<AnnouncementStatus, string> = {
  active: 'Activo',
  expired: 'Vencido',
  archived: 'Archivado',
}

/** Una fila de `v_announcements_admin`. */
export interface AnnouncementRow {
  id: string
  title: string
  body: string
  audience: AnnouncementAudience
  /** `yyyy-MM-dd` o `null` (sin vencimiento). */
  visibleUntil: string | null
  createdAt: string
  updatedAt: string | null
  contentUpdatedAt: string
  archivedAt: string | null
  createdBy: string | null
  createdByName: string | null
  status: AnnouncementStatus
  recipientCount: number
  readCount: number
}

/** Una fila de `v_announcement_recipients`. */
export interface AnnouncementRecipient {
  profileId: string
  firstName: string
  lastName: string
  roles: string[]
  /** `timestamptz` o `null` si todavía no lo leyó. */
  readAt: string | null
}

export interface AnnouncementInput {
  title: string
  body: string
  audience: AnnouncementAudience
  /** `yyyy-MM-dd` o `null` para sin vencimiento. */
  visibleUntil: string | null
  /** Solo se usa con `audience === 'custom'`. */
  recipientIds: string[]
}

type AdminViewRow = Database['public']['Views']['v_announcements_admin']['Row']

function mapRow(row: AdminViewRow): AnnouncementRow {
  return {
    id: row.id as string,
    title: row.title as string,
    body: row.body as string,
    audience: row.audience as AnnouncementAudience,
    visibleUntil: row.visible_until,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at,
    contentUpdatedAt: row.content_updated_at as string,
    archivedAt: row.archived_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    status: row.status as AnnouncementStatus,
    recipientCount: row.recipient_count ?? 0,
    readCount: row.read_count ?? 0,
  }
}

/** Listado (ADM-AN-01). `status` filtra en el servidor; sin él trae todos. */
export async function fetchAnnouncements(
  status?: AnnouncementStatus,
): Promise<AnnouncementRow[]> {
  let query = supabase
    .from('v_announcements_admin')
    .select('*')
    .order('created_at', { ascending: false })
  if (status) {
    query = query.eq('status', status)
  }
  const { data, error } = await query
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map(mapRow)
}

/** Detalle de uno; `null` si no existe. */
export async function fetchAnnouncement(
  id: string,
): Promise<AnnouncementRow | null> {
  const { data, error } = await supabase
    .from('v_announcements_admin')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    throw fromPostgrestError(error)
  }
  return data ? mapRow(data) : null
}

/** «Quién lo leyó»: destinatarios actuales con su fecha de lectura. */
export async function fetchAnnouncementRecipients(
  id: string,
): Promise<AnnouncementRecipient[]> {
  const { data, error } = await supabase
    .from('v_announcement_recipients')
    .select('profile_id, first_name, last_name, roles, read_at')
    .eq('announcement_id', id)
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    profileId: row.profile_id as string,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    roles: row.roles ?? [],
    readAt: row.read_at,
  }))
}

/** Personas guardadas de un anuncio `custom`, para precargar la edición. */
export async function fetchAnnouncementRecipientIds(
  id: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('announcement_recipients')
    .select('profile_id')
    .eq('announcement_id', id)
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => row.profile_id)
}

/** Solo `custom` manda destinatarios; en el resto el servidor los limpia. */
function recipientsArg(input: AnnouncementInput): string[] | undefined {
  return input.audience === 'custom' ? input.recipientIds : undefined
}

export async function createAnnouncement(
  input: AnnouncementInput,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_announcement', {
    p_title: input.title,
    p_body: input.body,
    p_audience: input.audience,
    p_visible_until: input.visibleUntil ?? undefined,
    p_recipient_ids: recipientsArg(input),
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return data.id
}

/** Reemplaza todos los campos: `visibleUntil` en `null` quita el vencimiento. */
export async function updateAnnouncement(
  id: string,
  input: AnnouncementInput,
): Promise<void> {
  const { error } = await supabase.rpc('update_announcement', {
    p_id: id,
    p_title: input.title,
    p_body: input.body,
    p_audience: input.audience,
    p_visible_until: input.visibleUntil ?? undefined,
    p_recipient_ids: recipientsArg(input),
  })
  if (error) {
    throw fromPostgrestError(error)
  }
}

/** Idempotente. */
export async function archiveAnnouncement(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_announcement', { p_id: id })
  if (error) {
    throw fromPostgrestError(error)
  }
}
