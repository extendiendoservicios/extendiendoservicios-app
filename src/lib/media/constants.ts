/**
 * Límites de la evidencia fotográfica (módulo H, decisiones H-05, H-06, H-11
 * y H-16 de `Docs/Plan_Maestro/modulos/H_evidencia_fotografica.md`).
 */

/** Lado mayor de la foto comprimida (H-05). */
export const PHOTO_MAX_SIDE_PX = 1280
/** Calidad JPEG inicial (H-05). */
export const PHOTO_QUALITY = 0.72
/**
 * Si la foto pasa de este tamaño se baja la calidad un paso por vez
 * (§3: "si pasa de 300 KB, baja la calidad un paso").
 */
export const PHOTO_TARGET_MAX_BYTES = 300 * 1024
/** Escalones de calidad, de mayor a menor; el primero es `PHOTO_QUALITY`. */
export const PHOTO_QUALITY_STEPS = [0.72, 0.64, 0.56, 0.48, 0.4] as const

/** Lado mayor de la miniatura (H-16). */
export const THUMB_MAX_SIDE_PX = 320
export const THUMB_QUALITY = 0.7

/** Duración máxima de un video (H-06). */
export const VIDEO_MAX_SECONDS = 30
/**
 * Tolerancia sobre los 30 s: un video grabado «de 30 segundos» suele durar
 * 30,03 s. Se rechaza recién por encima de 30,5 s (decisión menor).
 */
export const VIDEO_DURATION_TOLERANCE_S = 0.5
/** Tamaño máximo del video ya comprimido (H-06). */
export const VIDEO_MAX_BYTES = 20 * 1024 * 1024
/** Lado MENOR del video de salida: 480p (H-06). */
export const VIDEO_SHORT_SIDE_PX = 480
/** Resolución pedida a la cámara al grabar dentro de la app (§3). */
export const VIDEO_RECORD_WIDTH = 854
export const VIDEO_RECORD_HEIGHT = 480
export const VIDEO_BITRATE = 700_000
export const AUDIO_BITRATE = 64_000
export const VIDEO_FRAME_RATE = 30

/** Topes por persona y por turno (H-11). Se usan como valor por defecto. */
export const DEFAULT_MEDIA_LIMITS = { photos: 10, videos: 2 } as const
