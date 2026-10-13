/**
 * Tipos compartidos de la captura de evidencia (módulo H, P21.2).
 */

export type MediaKind = 'photo' | 'video'

export type MediaMimeType = 'image/jpeg' | 'video/mp4' | 'video/webm'

/**
 * Un archivo ya comprimido y listo para subir. Es lo que devuelven
 * `compressImage`, `compressVideo` y `recordVideo`, y lo que recibe la
 * función `upload` de `MediaCapture`.
 */
export interface ProcessedMedia {
  kind: MediaKind
  /** Archivo principal (foto JPEG, o video MP4/WebM). */
  file: Blob
  mimeType: MediaMimeType
  /** Extensión sin punto para la ruta de Storage: `jpg`, `mp4` o `webm`. */
  extension: 'jpg' | 'mp4' | 'webm'
  /** Miniatura JPEG de ~320 px (H-16). */
  thumbnail: Blob
  width: number
  height: number
  /** Bytes del archivo principal. */
  bytes: number
  /** Bytes de la miniatura. */
  thumbnailBytes: number
  /** `size_bytes` de `shift_media`: archivo más miniatura. */
  totalBytes: number
  /** Duración en segundos; `null` en las fotos. */
  durationSeconds: number | null
  /**
   * Cuándo se sacó la foto o el video, leído del archivo antes de descartar
   * los metadatos (EXIF `DateTimeOriginal`, o la fecha de modificación del
   * archivo). `null` si no se pudo saber. Va a `shift_media.captured_at`.
   */
  capturedAt: Date | null
  /** Solo videos de la galería: camino que se usó para recomprimir. */
  mode?: 'webcodecs' | 'realtime'
  /** Solo videos: `false` si el resultado quedó sin audio. */
  hasAudio?: boolean
}

/** Lo que `MediaCapture` le pasa a la función `upload` inyectada. */
export interface MediaUploadContext {
  /** Se aborta cuando la persona cancela la subida. */
  signal: AbortSignal
  /** Informar el avance de la subida, de 0 a 1. */
  onProgress: (fraction: number) => void
}

/** Lo que devuelve `upload` cuando la subida y la confirmación terminaron. */
export interface UploadedMedia {
  /** `shift_media.id` de la fila ya confirmada. */
  id: string
}

/**
 * Función de subida que inyecta quien usa `MediaCapture` (P21.3/P21.4 con
 * `src/api/media.ts`). Tiene que hacer el flujo completo:
 *
 * 1. `begin_shift_media(shift_id, kind, p_size_bytes = media.bytes, p_thumb_size_bytes = media.thumbnailBytes, …)` (la base suma los dos):
 *    valida rol, ventana, tope, sede y tamaño; crea la fila pendiente y
 *    devuelve las rutas `{shift_id}/{media_id}.{ext}` y `…_thumb.jpg`.
 * 2. Subir `media.file` y `media.thumbnail` a Storage (bucket `evidence`).
 * 3. `confirm_shift_media(id)`.
 *
 * Si algo falla tiene que lanzar un `Error` con el mensaje YA en español
 * (se muestra tal cual junto al botón «Reintentar»). Si `signal` se aborta
 * tiene que cortar y lanzar cualquier error: el componente lo toma como
 * cancelación.
 */
export type MediaUploadFn = (
  media: ProcessedMedia,
  context: MediaUploadContext,
) => Promise<UploadedMedia>
