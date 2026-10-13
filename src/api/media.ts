import { supabase } from '@/lib/supabase'
import type { MediaUploadFn, ProcessedMedia } from '@/lib/media/types'
import { ApiError, fromPostgrestError } from './errors'

/**
 * `src/api/media.ts` (módulo H, P21.3): la parte de celular de la evidencia
 * fotográfica -- subir, listar lo propio, firmar URL y quitar. Lo de
 * administración (listado general, «Conservar», medidor, plazos) vive en
 * `src/api/mediaAdmin.ts` (P21.4).
 *
 * Flujo de subida (contrato de P21.1):
 *
 * 1. `begin_shift_media`: valida rol, ventana, tope, sede y tamaño, crea la
 *    fila pendiente y devuelve las rutas `{shift_id}/{media_id}.{ext}` y
 *    `{shift_id}/{media_id}_thumb.jpg`.
 * 2. Se sube el archivo y después la miniatura al bucket `evidence`, sin
 *    `upsert` (las políticas de Storage solo dejan escribir en las rutas de
 *    una fila pendiente propia).
 * 3. `confirm_shift_media`: el servidor verifica que los dos objetos existan.
 *
 * Si algo falla después del paso 1 se descarta lo pendiente (mejor
 * esfuerzo): `remove_shift_media` marca la fila como quitada y se borran los
 * dos objetos. Lo que no llegue a limpiarse lo barre la limpieza nocturna.
 *
 * Los mensajes de error salen siempre en español con voseo; el código estable
 * va en `ApiError.hint`.
 */

export const EVIDENCE_BUCKET = 'evidence'

/** Vida de las URL firmadas (segundos): alcanza para una sesión de visor. */
export const SIGNED_URL_TTL_SECONDS = 600

// -------------------------------------------------------------------------
// 1. Errores (`hint` -> mensaje en español)
// -------------------------------------------------------------------------

/**
 * Mensaje para cada código de error de las RPC del módulo H. Pisan el texto
 * del servidor cuando lo hay: así la redacción queda pensada para la persona
 * que está en la sede con el celular en la mano.
 */
export const MEDIA_HINT_MESSAGES: Record<string, string> = {
  FORBIDDEN: 'No tenés permiso para hacer esto.',
  SHIFT_NOT_FOUND: 'No encontramos ese turno.',
  NOT_SHIFT_PARTICIPANT: 'No participás de este turno.',
  SHIFT_CANCELLED: 'Este turno está cancelado: no se pueden subir archivos.',
  PHOTOS_NOT_ALLOWED: 'En esta sede no se permiten fotos ni videos.',
  MEDIA_WINDOW_NOT_OPEN:
    'Todavía no podés subir fotos o videos: el turno no empezó.',
  MEDIA_WINDOW_CLOSED:
    'Ya pasó el plazo para subir o quitar fotos y videos de este turno (2 horas después del fin).',
  MEDIA_INVALID_TYPE:
    'Ese formato no sirve. Las fotos tienen que ser JPEG y los videos MP4 o WebM.',
  MEDIA_INVALID_SIZE: 'El archivo está vacío o dañado. Probá con otro.',
  MEDIA_TOO_LARGE: 'El archivo pesa más de 20 MB. Tiene que ser más liviano.',
  MEDIA_INVALID_DURATION:
    'No pudimos saber cuánto dura el video. Probá con otro.',
  MEDIA_TOO_LONG: 'El video dura más de 30 segundos. Elegí uno más corto.',
  MEDIA_LIMIT_REACHED:
    'Ya llegaste al tope de archivos de este turno: 10 fotos y 2 videos.',
  MEDIA_NOT_FOUND: 'No encontramos ese archivo. Puede que ya se haya quitado.',
  NOT_YOUR_MEDIA: 'Ese archivo no es tuyo, así que no lo podés cambiar.',
  MEDIA_REMOVED: 'Ese archivo ya se había quitado.',
  MEDIA_UPLOAD_INCOMPLETE:
    'La subida no se completó. Revisá la señal y probá de nuevo.',
}

export const MEDIA_UPLOAD_FAILED_MESSAGE =
  'No pudimos subir el archivo. Revisá la señal y probá de nuevo.'
export const MEDIA_REMOVE_FAILED_MESSAGE =
  'No pudimos quitar el archivo. Probá de nuevo.'

/** Convierte el error de una RPC del módulo H en un `ApiError` con el texto de arriba. */
function mediaRpcError(error: {
  code?: string | null
  message: string
  hint?: string | null
}): ApiError {
  const base = fromPostgrestError(error)
  const friendly = base.hint ? MEDIA_HINT_MESSAGES[base.hint] : undefined
  return friendly ? new ApiError(friendly, base.hint) : base
}

/** Mensaje de un error cualquiera que salga de este módulo, para mostrar tal cual. */
export function mediaApiErrorMessage(
  error: unknown,
  fallback = MEDIA_UPLOAD_FAILED_MESSAGE,
): string {
  return error instanceof ApiError ? error.message : fallback
}

// -------------------------------------------------------------------------
// 2. Subida
// -------------------------------------------------------------------------

function abortError(): Error {
  return new DOMException('La subida se canceló.', 'AbortError')
}

/** Corta la espera cuando se aborta: la subida en curso queda sin efecto para la persona. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // La promesa original puede fallar después: se la absorbe para que no quede sin manejar.
    promise.catch(() => undefined)
    return Promise.reject(abortError())
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

interface BegunUpload {
  id: string
  storagePath: string
  thumbPath: string
}

async function beginShiftMedia(
  shiftId: string,
  media: ProcessedMedia,
): Promise<BegunUpload> {
  const { data, error } = await supabase.rpc('begin_shift_media', {
    p_shift_id: shiftId,
    p_kind: media.kind,
    p_mime_type: media.mimeType,
    // El servidor suma los dos tamaños (y valida cada uno contra 20 MB):
    // `size_bytes` de la fila es archivo más miniatura.
    p_size_bytes: media.bytes,
    p_thumb_size_bytes: media.thumbnailBytes,
    p_width: media.width,
    p_height: media.height,
    p_duration_s: media.durationSeconds ?? undefined,
    p_captured_at: media.capturedAt?.toISOString(),
  })
  if (error) {
    throw mediaRpcError(error)
  }
  const result = data as unknown as {
    media: { id: string }
    storage_path: string
    thumb_path: string
  }
  return {
    id: result.media.id,
    storagePath: result.storage_path,
    thumbPath: result.thumb_path,
  }
}

async function uploadObject(
  path: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, blob, { contentType, upsert: false })
  if (error) {
    throw new ApiError(MEDIA_UPLOAD_FAILED_MESSAGE, 'MEDIA_UPLOAD_FAILED')
  }
}

async function confirmShiftMedia(mediaId: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_shift_media', {
    p_media_id: mediaId,
  })
  if (error) {
    throw mediaRpcError(error)
  }
}

/** Mejor esfuerzo: marca la fila como quitada y borra los objetos que hayan llegado. */
async function discardPendingUpload(begun: BegunUpload): Promise<void> {
  try {
    await supabase.rpc('remove_shift_media', { p_media_id: begun.id })
    await supabase.storage
      .from(EVIDENCE_BUCKET)
      .remove([begun.storagePath, begun.thumbPath])
  } catch {
    // La limpieza nocturna descarta las filas pendientes de más de 24 h.
  }
}

/**
 * Arma la `MediaUploadFn` que recibe `MediaCapture` para un turno. El progreso
 * avanza por etapas (la Storage API del cliente no informa bytes enviados):
 * 10 % al crear la fila, 20 % a 80 % con el archivo y la miniatura, 90 % al
 * confirmar y 100 % al terminar. Si se aborta, corta en la etapa en curso y
 * descarta lo pendiente.
 */
export function createShiftMediaUpload(shiftId: string): MediaUploadFn {
  return async (media, { signal, onProgress }) => {
    if (signal.aborted) throw abortError()
    onProgress(0.05)

    const begun = await raceAbort(beginShiftMedia(shiftId, media), signal)
    onProgress(0.1)

    try {
      await raceAbort(
        uploadObject(begun.storagePath, media.file, media.mimeType),
        signal,
      )
      onProgress(0.8)
      await raceAbort(
        uploadObject(begun.thumbPath, media.thumbnail, 'image/jpeg'),
        signal,
      )
      onProgress(0.9)
      await raceAbort(confirmShiftMedia(begun.id), signal)
      onProgress(1)
      return { id: begun.id }
    } catch (error) {
      await discardPendingUpload(begun)
      throw error
    }
  }
}

// -------------------------------------------------------------------------
// 3. Lo propio de un turno
// -------------------------------------------------------------------------

export type ShiftMediaKind = 'photo' | 'video'

/** Un archivo propio de un turno (fila confirmada y no quitada de `v_shift_media`). */
export interface MyShiftMedia {
  id: string
  shiftId: string
  kind: ShiftMediaKind
  storagePath: string
  thumbPath: string
  durationSeconds: number | null
  /** Cuándo se sacó, si se conoce; si no, cuándo se subió. */
  takenAt: string
  createdAt: string
  keep: boolean
  /** `YYYY-MM-DD`; `null` si no vence (conservado) o ya venció. */
  expiresOn: string | null
  /** `false` cuando el archivo ya se borró por vencimiento: queda la constancia. */
  hasFile: boolean
  /** URL firmada de la miniatura; `null` si el archivo ya no existe o no se pudo firmar. */
  thumbUrl: string | null
}

const MY_MEDIA_COLUMNS =
  'id, shift_id, kind, storage_path, thumb_path, duration_s, captured_at, created_at, keep, expires_on, has_file'

/**
 * Lo que subió `userId` en el turno, de más viejo a más nuevo, con la URL
 * firmada de cada miniatura. Se filtra por `uploaded_by` además de la RLS:
 * una cuenta de administración que también trabaja en el turno vería todo.
 */
export async function fetchMyShiftMedia(
  shiftId: string,
  userId: string,
): Promise<MyShiftMedia[]> {
  const { data, error } = await supabase
    .from('v_shift_media')
    .select(MY_MEDIA_COLUMNS)
    .eq('shift_id', shiftId)
    .eq('uploaded_by', userId)
    .order('created_at', { ascending: true })
  if (error) {
    throw fromPostgrestError(error)
  }

  const rows = data ?? []
  const withFile = rows.filter((row) => row.has_file)
  const thumbUrls = new Map<string, string>()
  if (withFile.length > 0) {
    const { data: signed } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrls(
        withFile.map((row) => row.thumb_path as string),
        SIGNED_URL_TTL_SECONDS,
      )
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) {
        thumbUrls.set(entry.path, entry.signedUrl)
      }
    }
  }

  return rows.map((row) => ({
    id: row.id as string,
    shiftId: row.shift_id as string,
    kind: row.kind as ShiftMediaKind,
    storagePath: row.storage_path as string,
    thumbPath: row.thumb_path as string,
    durationSeconds: row.duration_s,
    takenAt: (row.captured_at ?? row.created_at) as string,
    createdAt: row.created_at as string,
    keep: Boolean(row.keep),
    expiresOn: row.expires_on,
    hasFile: Boolean(row.has_file),
    thumbUrl: thumbUrls.get(row.thumb_path as string) ?? null,
  }))
}

/** URL firmada del original, de vida corta. Se pide recién al abrir el visor. */
export async function signMediaUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) {
    throw new ApiError(
      'No pudimos abrir el archivo. Probá de nuevo.',
      'MEDIA_URL_FAILED',
    )
  }
  return data.signedUrl
}

// -------------------------------------------------------------------------
// 4. Quitar (H-15)
// -------------------------------------------------------------------------

/**
 * El autor quita lo que subió mientras la ventana esté abierta:
 * `remove_shift_media` marca la fila y después se borran el archivo y la
 * miniatura. Si el borrado de Storage falla no es un error para la persona:
 * la fila ya quedó quitada y la limpieza nocturna borra los objetos.
 */
export async function removeShiftMedia(media: {
  id: string
  storagePath: string
  thumbPath: string
}): Promise<void> {
  const { error } = await supabase.rpc('remove_shift_media', {
    p_media_id: media.id,
  })
  if (error) {
    throw mediaRpcError(error)
  }
  try {
    await supabase.storage
      .from(EVIDENCE_BUCKET)
      .remove([media.storagePath, media.thumbPath])
  } catch {
    // Mejor esfuerzo, ver arriba.
  }
}
