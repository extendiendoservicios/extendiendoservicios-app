/**
 * Ventana para subir y quitar fotos y videos (módulo H, H-12): desde el
 * inicio del turno hasta 2 horas después del fin.
 *
 * Es solo una ayuda para la pantalla (apagar los botones y decir por qué). La
 * regla real la aplica el servidor con su propio reloj (`MEDIA_WINDOW_NOT_OPEN`
 * y `MEDIA_WINDOW_CLOSED` en `begin_shift_media` y `remove_shift_media`), así
 * que un reloj del teléfono corrido nunca deja pasar algo que no corresponde.
 */

export const MEDIA_WINDOW_GRACE_MS = 2 * 60 * 60 * 1000

export const MEDIA_WINDOW_BEFORE_MESSAGE =
  'Vas a poder subir fotos y videos desde que empiece el turno.'
export const MEDIA_WINDOW_AFTER_MESSAGE =
  'Ya pasó el plazo para subir fotos y videos de este turno (2 horas después del fin).'

export type MediaWindowState = 'before' | 'open' | 'after'

/**
 * `startsAt` y `endsAt` son instantes ISO (los `starts_at`/`ends_at` de la
 * vista). Sin alguno de los dos no se puede saber: se deja abierta y decide el
 * servidor.
 */
export function mediaWindowState(
  now: Date,
  startsAt: string | null,
  endsAt: string | null,
): MediaWindowState {
  if (startsAt && now.getTime() < new Date(startsAt).getTime()) return 'before'
  if (
    endsAt &&
    now.getTime() > new Date(endsAt).getTime() + MEDIA_WINDOW_GRACE_MS
  ) {
    return 'after'
  }
  return 'open'
}

export function mediaWindowMessage(
  state: MediaWindowState,
): string | undefined {
  if (state === 'before') return MEDIA_WINDOW_BEFORE_MESSAGE
  if (state === 'after') return MEDIA_WINDOW_AFTER_MESSAGE
  return undefined
}
