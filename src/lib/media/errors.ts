/**
 * Errores tipados de la captura y compresión de evidencia. Los mensajes
 * están en español rioplatense y se pueden mostrar tal cual a la persona.
 */

export type MediaErrorCode =
  | 'unsupported_file'
  | 'image_unreadable'
  | 'video_unreadable'
  | 'video_too_long'
  | 'video_too_large'
  | 'limit_reached'
  | 'camera_denied'
  | 'camera_unavailable'
  | 'recording_unsupported'
  | 'recording_failed'
  | 'compression_failed'
  | 'canceled'
  | 'download_failed'

export const MEDIA_ERROR_MESSAGES: Record<MediaErrorCode, string> = {
  unsupported_file: 'Ese archivo no es una foto ni un video que podamos usar.',
  image_unreadable: 'No pudimos leer esa foto. Probá con otra.',
  video_unreadable: 'No pudimos leer ese video. Probá con otro.',
  video_too_long: 'El video dura más de 30 segundos. Elegí uno más corto.',
  video_too_large:
    'El video pesa más de 20 MB incluso comprimido. Elegí uno más corto.',
  limit_reached: 'Ya llegaste al tope de archivos de este turno.',
  camera_denied:
    'No tenemos permiso para usar la cámara. Habilitala en los ajustes del navegador.',
  camera_unavailable: 'No encontramos una cámara disponible en este teléfono.',
  recording_unsupported:
    'Este navegador no puede grabar video desde la app. Elegí un video de la galería.',
  recording_failed: 'Se cortó la grabación. Probá de nuevo.',
  compression_failed:
    'No pudimos preparar el video. Probá con otro o grabalo desde la app.',
  canceled: 'Se canceló.',
  download_failed: 'No pudimos descargar el archivo. Probá de nuevo.',
}

export class MediaError extends Error {
  readonly code: MediaErrorCode

  constructor(code: MediaErrorCode, message?: string, options?: ErrorOptions) {
    super(message ?? MEDIA_ERROR_MESSAGES[code], options)
    this.name = 'MediaError'
    this.code = code
  }
}

export function isMediaError(error: unknown): error is MediaError {
  return error instanceof MediaError
}

/** Mensaje en español para mostrar, venga el error de donde venga. */
export function mediaErrorMessage(error: unknown): string {
  if (isMediaError(error)) return error.message
  return 'Ocurrió un error inesperado. Probá de nuevo.'
}
