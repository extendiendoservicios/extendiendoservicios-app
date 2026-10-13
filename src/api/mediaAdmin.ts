import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { ApiError, fromPostgrestError } from './errors'

/**
 * `src/api/mediaAdmin.ts` (módulo H, P21.4): la parte de administración de
 * la evidencia fotográfica. Lo de subir y lo propio de cada persona (celular)
 * vive en `src/api/media.ts` (P21.3); no se mezclan.
 *
 * - `v_shift_media` (security_invoker): solo filas confirmadas y no quitadas.
 *   Dueño y administradores ven todo; RLS lo resuelve, acá no se filtra por rol.
 * - `set_shift_media_keep`, `storage_usage` y `set_media_retention`: RPC.
 * - URL firmadas en lote (`createSignedUrls`) para miniaturas y originales.
 *   El bucket `evidence` es privado: nunca se arma una URL pública.
 */

export type MediaKind = Database['public']['Enums']['media_kind']

export const EVIDENCE_BUCKET = 'evidence'

/** Vida de las URL de las miniaturas: la grilla se queda abierta un rato. */
export const THUMB_URL_TTL_SECONDS = 30 * 60
/** Vida de la URL de un original: se pide justo al abrir el visor o al descargar. */
export const ORIGINAL_URL_TTL_SECONDS = 5 * 60

/** Filas por página de la pantalla ADM-32 (una URL firmada por miniatura). */
export const MEDIA_PAGE_SIZE = 48

// -------------------------------------------------------------------------
// Errores (hint -> mensaje en español)
// -------------------------------------------------------------------------

const MEDIA_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Solo la dueña o un administrador puede hacer esto.',
  KEEP_REQUIRED: 'Falta indicar si el archivo se conserva o no.',
  MEDIA_NOT_FOUND:
    'No encontramos el archivo. Puede que lo haya quitado quien lo subió.',
  MEDIA_EXPIRED:
    'El archivo ya venció y se borró: de él queda solo la constancia.',
  RETENTION_OUT_OF_RANGE: 'Los plazos tienen que ser de 7 a 365 días.',
}

/** Pasa el error de las RPC de evidencia a `ApiError` con el mensaje en español de cada `hint`. */
export function mapMediaAdminError(error: {
  code?: string | null
  message: string
  hint?: string | null
}): ApiError {
  const mapped = error.hint ? MEDIA_ERROR_MESSAGES[error.hint] : undefined
  if (mapped && error.hint) {
    return new ApiError(mapped, error.hint)
  }
  return fromPostgrestError(error)
}

// -------------------------------------------------------------------------
// 1. Lectura de v_shift_media
// -------------------------------------------------------------------------

export interface ShiftMediaRow {
  id: string
  shiftId: string
  /** `YYYY-MM-DD`. */
  shiftDate: string
  clientId: string
  clientName: string
  siteId: string
  siteName: string
  assignmentId: string | null
  supervisionId: string | null
  uploadedBy: string
  uploaderName: string
  /** `employee` o `supervisor`. */
  uploaderRole: string | null
  kind: MediaKind
  storagePath: string
  thumbPath: string
  sizeBytes: number
  width: number | null
  height: number | null
  durationSeconds: number | null
  capturedAt: string | null
  createdAt: string
  keep: boolean
  /** `false` = vencida: queda la constancia, sin archivo. */
  hasFile: boolean
  /** Día en que vence (`YYYY-MM-DD`); `null` si se conserva o ya venció. */
  expiresOn: string | null
  retentionDays: number | null
}

interface ShiftMediaRawRow {
  id: string | null
  shift_id: string | null
  shift_date: string | null
  client_id: string | null
  client_name: string | null
  site_id: string | null
  site_name: string | null
  assignment_id: string | null
  supervision_id: string | null
  uploaded_by: string | null
  uploader_first_name: string | null
  uploader_last_name: string | null
  uploader_role: string | null
  kind: MediaKind | null
  storage_path: string | null
  thumb_path: string | null
  size_bytes: number | null
  width: number | null
  height: number | null
  duration_s: number | null
  captured_at: string | null
  created_at: string | null
  keep: boolean | null
  has_file: boolean | null
  expires_on: string | null
  retention_days: number | null
}

const SHIFT_MEDIA_SELECT =
  'id, shift_id, shift_date, client_id, client_name, site_id, site_name, assignment_id, supervision_id, uploaded_by, uploader_first_name, uploader_last_name, uploader_role, kind, storage_path, thumb_path, size_bytes, width, height, duration_s, captured_at, created_at, keep, has_file, expires_on, retention_days'

function mapShiftMediaRow(row: ShiftMediaRawRow): ShiftMediaRow {
  return {
    id: row.id ?? '',
    shiftId: row.shift_id ?? '',
    shiftDate: row.shift_date ?? '',
    clientId: row.client_id ?? '',
    clientName: row.client_name ?? '',
    siteId: row.site_id ?? '',
    siteName: row.site_name ?? '',
    assignmentId: row.assignment_id,
    supervisionId: row.supervision_id,
    uploadedBy: row.uploaded_by ?? '',
    uploaderName:
      `${row.uploader_first_name ?? ''} ${row.uploader_last_name ?? ''}`.trim(),
    uploaderRole: row.uploader_role,
    kind: row.kind ?? 'photo',
    storagePath: row.storage_path ?? '',
    thumbPath: row.thumb_path ?? '',
    sizeBytes: row.size_bytes ?? 0,
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_s,
    capturedAt: row.captured_at,
    createdAt: row.created_at ?? '',
    keep: row.keep ?? false,
    hasFile: row.has_file ?? false,
    expiresOn: row.expires_on,
    retentionDays: row.retention_days,
  }
}

export interface ShiftMediaFilters {
  /** Desde esta fecha de turno (incluida), `YYYY-MM-DD`. */
  dateFrom?: string
  /** Hasta esta fecha de turno (incluida), `YYYY-MM-DD`. */
  dateTo?: string
  clientId?: string
  siteId?: string
  /** `profiles.id` de quien subió. */
  uploadedBy?: string
  kind?: MediaKind
  /** Solo las marcadas «Conservar». */
  keepOnly?: boolean
  /**
   * Solo las que vencen hasta esta fecha (`YYYY-MM-DD`): con archivo, sin
   * «Conservar». La pantalla manda hoy + 7 días («Por vencer en 7 días»).
   */
  expiresBy?: string
}

export interface ShiftMediaPage {
  rows: ShiftMediaRow[]
  /** Posición de la página (0, 1, 2…). */
  page: number
  /** Hay más páginas después de esta. */
  hasMore: boolean
}

/**
 * Una página de `v_shift_media`, de la más reciente a la más antigua. Dentro
 * de un turno el orden es estable (`created_at`, `id`) y las filas de un
 * mismo turno quedan juntas, así que las páginas se pueden unir sin reordenar
 * (un turno que cae justo en el corte sigue en la página siguiente).
 */
export async function fetchShiftMediaPage(
  filters: ShiftMediaFilters,
  page: number,
  pageSize: number = MEDIA_PAGE_SIZE,
): Promise<ShiftMediaPage> {
  let query = supabase
    .from('v_shift_media')
    .select(SHIFT_MEDIA_SELECT)
    .order('shift_date', { ascending: false })
    .order('shift_id', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    // Se pide una fila de más para saber si hay otra página sin un conteo aparte.
    .range(page * pageSize, page * pageSize + pageSize)

  if (filters.dateFrom) query = query.gte('shift_date', filters.dateFrom)
  if (filters.dateTo) query = query.lte('shift_date', filters.dateTo)
  if (filters.clientId) query = query.eq('client_id', filters.clientId)
  if (filters.siteId) query = query.eq('site_id', filters.siteId)
  if (filters.uploadedBy) query = query.eq('uploaded_by', filters.uploadedBy)
  if (filters.kind) query = query.eq('kind', filters.kind)
  if (filters.keepOnly) query = query.eq('keep', true)
  if (filters.expiresBy) {
    query = query
      .eq('keep', false)
      .eq('has_file', true)
      .lte('expires_on', filters.expiresBy)
  }

  const { data, error } = await query
  if (error) {
    throw mapMediaAdminError(error)
  }

  const raw = (data ?? []) as unknown as ShiftMediaRawRow[]
  const hasMore = raw.length > pageSize
  return {
    rows: raw.slice(0, pageSize).map(mapShiftMediaRow),
    page,
    hasMore,
  }
}

/** Tope de seguridad de las listas de un solo turno o supervisión. */
const SINGLE_LIST_LIMIT = 200

/** Todo lo de un turno (ADM-06): fotos y videos de todas las personas. */
export async function fetchShiftMediaByShift(
  shiftId: string,
): Promise<ShiftMediaRow[]> {
  const { data, error } = await supabase
    .from('v_shift_media')
    .select(SHIFT_MEDIA_SELECT)
    .eq('shift_id', shiftId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(SINGLE_LIST_LIMIT)

  if (error) {
    throw mapMediaAdminError(error)
  }
  return ((data ?? []) as unknown as ShiftMediaRawRow[]).map(mapShiftMediaRow)
}

/** Lo que subió el supervisor en una supervisión (ADM-15). */
export async function fetchShiftMediaBySupervision(
  supervisionId: string,
): Promise<ShiftMediaRow[]> {
  const { data, error } = await supabase
    .from('v_shift_media')
    .select(SHIFT_MEDIA_SELECT)
    .eq('supervision_id', supervisionId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(SINGLE_LIST_LIMIT)

  if (error) {
    throw mapMediaAdminError(error)
  }
  return ((data ?? []) as unknown as ShiftMediaRawRow[]).map(mapShiftMediaRow)
}

// -------------------------------------------------------------------------
// 2. URL firmadas en lote
// -------------------------------------------------------------------------

/** Mapa ruta -> URL firmada. Las rutas que no se pudieron firmar no aparecen. */
export type SignedUrlMap = Map<string, string>

/**
 * Firma varias rutas del bucket `evidence` en una sola llamada. Quita los
 * duplicados y las rutas vacías. Si Storage rechaza una ruta (por ejemplo,
 * el archivo ya se borró), esa ruta queda sin URL y el resto sigue.
 */
export async function createEvidenceSignedUrls(
  paths: readonly string[],
  expiresInSeconds: number,
): Promise<SignedUrlMap> {
  const unique = Array.from(new Set(paths.filter((path) => path !== '')))
  const result: SignedUrlMap = new Map()
  if (unique.length === 0) {
    return result
  }

  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrls(unique, expiresInSeconds)

  if (error) {
    throw new ApiError(
      'No pudimos cargar las imágenes. Probá de nuevo en un momento.',
      null,
    )
  }
  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) {
      result.set(item.path, item.signedUrl)
    }
  }
  return result
}

/** Miniaturas de las filas con archivo (las vencidas no tienen qué firmar). */
export function createThumbSignedUrls(
  rows: readonly ShiftMediaRow[],
): Promise<SignedUrlMap> {
  return createEvidenceSignedUrls(
    rows.filter((row) => row.hasFile).map((row) => row.thumbPath),
    THUMB_URL_TTL_SECONDS,
  )
}

/** URL firmada del original, justo antes de mostrarlo o descargarlo. */
export async function createOriginalSignedUrl(
  storagePath: string,
): Promise<string> {
  const urls = await createEvidenceSignedUrls(
    [storagePath],
    ORIGINAL_URL_TTL_SECONDS,
  )
  const url = urls.get(storagePath)
  if (!url) {
    throw new ApiError(
      'No pudimos abrir el archivo. Puede que ya haya vencido.',
      'MEDIA_EXPIRED',
    )
  }
  return url
}

// -------------------------------------------------------------------------
// 3. Conservar (set_shift_media_keep)
// -------------------------------------------------------------------------

export interface KeepResult {
  id: string
  keep: boolean
}

/** Marca o desmarca «Conservar» (dueño y administradores). Lo conservado no vence. */
export async function setShiftMediaKeep(
  mediaId: string,
  keep: boolean,
): Promise<KeepResult> {
  const { data, error } = await supabase.rpc('set_shift_media_keep', {
    p_media_id: mediaId,
    p_keep: keep,
  })
  if (error) {
    throw mapMediaAdminError(error)
  }
  return { id: data.id, keep: data.keep }
}

// -------------------------------------------------------------------------
// 4. Medidor de espacio (storage_usage)
// -------------------------------------------------------------------------

export type StorageLevel = 'ok' | 'warning' | 'critical'

export interface StorageBucketUsage {
  bucket: string
  bytes: number
  objects: number
}

export interface StorageUsage {
  totalBytes: number
  limitBytes: number
  /** Porcentaje usado, tal como lo calcula el servidor. */
  percent: number
  level: StorageLevel
  buckets: StorageBucketUsage[]
}

/** Nombres en español de los buckets, para el desglose del medidor. */
export const STORAGE_BUCKET_LABELS: Record<string, string> = {
  evidence: 'Fotos y videos de los turnos',
  avatars: 'Fotos de perfil',
  branding: 'Logo',
  'client-photos': 'Fotos de clientes',
}

export function storageBucketLabel(bucket: string): string {
  return STORAGE_BUCKET_LABELS[bucket] ?? bucket
}

const STORAGE_LEVELS: readonly string[] = ['ok', 'warning', 'critical']

/** Normaliza el JSON de `storage_usage()`; ante un nivel raro lo deduce del porcentaje. */
export function parseStorageUsage(payload: unknown): StorageUsage {
  const raw = (payload ?? {}) as {
    total_bytes?: number | string
    limit_bytes?: number | string
    percent?: number | string
    level?: string
    buckets?: Array<{
      bucket?: string
      name?: string
      bytes?: number | string
      total_bytes?: number | string
      objects?: number | string
      count?: number | string
    }>
  }
  const totalBytes = Number(raw.total_bytes ?? 0)
  const limitBytes = Number(raw.limit_bytes ?? 0)
  const percent =
    raw.percent != null
      ? Number(raw.percent)
      : limitBytes > 0
        ? (totalBytes / limitBytes) * 100
        : 0
  const level: StorageLevel =
    raw.level && STORAGE_LEVELS.includes(raw.level)
      ? (raw.level as StorageLevel)
      : percent >= 90
        ? 'critical'
        : percent >= 70
          ? 'warning'
          : 'ok'
  return {
    totalBytes,
    limitBytes,
    percent,
    level,
    buckets: (raw.buckets ?? []).map((bucket) => ({
      bucket: bucket.bucket ?? bucket.name ?? '',
      bytes: Number(bucket.bytes ?? bucket.total_bytes ?? 0),
      objects: Number(bucket.objects ?? bucket.count ?? 0),
    })),
  }
}

/** Espacio usado sobre el tope de 1 GB (dueño y administradores). */
export async function fetchStorageUsage(): Promise<StorageUsage> {
  const { data, error } = await supabase.rpc('storage_usage')
  if (error) {
    throw mapMediaAdminError(error)
  }
  return parseStorageUsage(data)
}

// -------------------------------------------------------------------------
// 5. Plazos de vencimiento (set_media_retention)
// -------------------------------------------------------------------------

export interface MediaRetention {
  photoDays: number
  videoDays: number
}

/** Rango que acepta el servidor (H-17). */
export const RETENTION_MIN_DAYS = 7
export const RETENTION_MAX_DAYS = 365

/** Plazos vigentes de `company_settings` (la fila única, `id = 1`). */
export async function fetchMediaRetention(): Promise<MediaRetention> {
  const { data, error } = await supabase
    .from('company_settings')
    .select('photo_retention_days, video_retention_days')
    .eq('id', 1)
    .single()
  if (error) {
    throw mapMediaAdminError(error)
  }
  return {
    photoDays: data.photo_retention_days,
    videoDays: data.video_retention_days,
  }
}

/** Cambia uno o los dos plazos. El nuevo plazo vale también para lo ya guardado (H-17). */
export async function setMediaRetention(
  input: Partial<MediaRetention>,
): Promise<MediaRetention> {
  const { data, error } = await supabase.rpc('set_media_retention', {
    p_photo_days: input.photoDays,
    p_video_days: input.videoDays,
  })
  if (error) {
    throw mapMediaAdminError(error)
  }
  return {
    photoDays: data.photo_retention_days,
    videoDays: data.video_retention_days,
  }
}
