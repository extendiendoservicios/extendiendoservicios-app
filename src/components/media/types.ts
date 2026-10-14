import type { MediaKind } from '@/lib/media/types'

/**
 * Un archivo de evidencia tal como lo muestran `MediaGrid` y `MediaViewer`.
 * Se arma a partir de `v_shift_media` (P21.1); este componente no sabe nada
 * de Supabase, quien lo usa traduce las filas y firma las URL.
 */
export interface MediaItem {
  /** `shift_media.id`. */
  id: string
  kind: MediaKind
  /** URL firmada de la miniatura (`thumb_path`). `null` si todavía no se firmó. */
  thumbUrl: string | null
  /**
   * URL firmada del original (`storage_path`). `null` si todavía no se firmó:
   * el visor la pide con `resolveUrl`. Las URL firmadas viven poco, por eso se
   * piden recién al abrir el visor.
   */
  url?: string | null
  /** Nombre accesible, p. ej. «Foto de Ana Pérez, 08:15». */
  label: string
  /** Quién la subió. */
  authorName?: string
  /** `captured_at` o, si no hay, `created_at`. */
  takenAt?: Date | string | null
  /** Día en que el archivo vence (`v_shift_media.expires_on`, `YYYY-MM-DD`). */
  expiresOn?: string | null
  /** Marcado «Conservar»: no vence. */
  keep?: boolean
  /** Duración en segundos (solo videos). */
  durationSeconds?: number | null
  /**
   * `expired`: el archivo ya se borró por vencimiento (queda la constancia).
   * `removed`: lo quitó quien lo subió (H-15).
   */
  unavailable?: 'expired' | 'removed' | null
  /** Para el visor: oculta «Quitar» en este archivo aunque haya `onRemove`. */
  canRemove?: boolean
  /** Información extra del visor (administración). Sin esto, el visor muestra lo básico. */
  details?: MediaItemDetails
}

/**
 * Datos de contexto que el visor muestra debajo del archivo. Todos son
 * opcionales: el visor del celular (empleado/supervisor) no los pasa porque
 * el contexto ya está en la pantalla.
 */
export interface MediaItemDetails {
  /** «Cliente · Sede». */
  place?: string
  /** Texto ya armado, p. ej. «Turno del mar 13 oct, 13:45 a 17:45». */
  shiftLabel?: string
  /** «Empleado/a» o «Supervisor/a». */
  authorRole?: string
  /** `captured_at`: cuándo se sacó (puede faltar). */
  capturedAt?: Date | string | null
  /** `created_at`: cuándo se subió. */
  uploadedAt?: Date | string | null
  sizeBytes?: number | null
}

export interface MediaGridGroup {
  id: string
  /** Título del grupo, p. ej. «Cliente X · Sede Y». */
  title: string
  /** Detalle, p. ej. «jue 13 ago · 08:00 a 12:00». */
  subtitle?: string
  items: MediaItem[]
}
