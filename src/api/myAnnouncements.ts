import { supabase } from '@/lib/supabase'
import { fromPostgrestError } from './errors'

/**
 * `src/api/myAnnouncements.ts` (P19.6 paquete E, AJ2-03, parte del celular):
 * los anuncios de administración que le corresponden a la sesión
 * (`v_my_announcements`, migración `0042`) y el "Entendido"
 * (`acknowledge_announcement`).
 *
 * No tiene relación con `notices.ts` (avisos de demora y ausencia).
 * Pendiente = `readAt === null`. `wasEdited` significa que la persona ya lo
 * había leído pero el texto se corrigió después: se muestra con la marca
 * "Actualizado".
 */

export interface MyAnnouncement {
  id: string
  title: string
  body: string
  audience: string
  /** Fecha de calendario (`yyyy-mm-dd`) hasta la que se muestra, o `null` si no vence. */
  visibleUntil: string | null
  createdAt: string
  contentUpdatedAt: string
  /** Cuándo dio "Entendido" (a esta versión del texto); `null` si está pendiente. */
  readAt: string | null
  wasEdited: boolean
}

/** Código que devuelve `acknowledge_announcement` si el anuncio ya no le corresponde. */
export const ANNOUNCEMENT_NOT_AVAILABLE = 'ANNOUNCEMENT_NOT_AVAILABLE'

/** Anuncios vigentes para la sesión, los más nuevos primero. */
export async function fetchMyAnnouncements(): Promise<MyAnnouncement[]> {
  const { data, error } = await supabase
    .from('v_my_announcements')
    .select(
      'id, title, body, audience, visible_until, created_at, content_updated_at, read_at, was_edited',
    )
    .order('created_at', { ascending: false })
  if (error) throw fromPostgrestError(error)
  return (data ?? []).map((row) => ({
    id: row.id ?? '',
    title: row.title ?? '',
    body: row.body ?? '',
    audience: row.audience ?? '',
    visibleUntil: row.visible_until ?? null,
    createdAt: row.created_at ?? '',
    contentUpdatedAt: row.content_updated_at ?? '',
    readAt: row.read_at ?? null,
    wasEdited: row.was_edited ?? false,
  }))
}

/** "Entendido": registra que la persona lo leyó. Idempotente. */
export async function acknowledgeAnnouncement(id: string): Promise<void> {
  const { error } = await supabase.rpc('acknowledge_announcement', {
    p_id: id,
  })
  if (error) throw fromPostgrestError(error)
}
