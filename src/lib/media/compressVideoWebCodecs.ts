/**
 * Camino principal de `compressVideo`: WebCodecs, con Mediabunny como muxer
 * MP4 (ver `docs/design-system.md`, «Evidencia fotográfica», para la
 * justificación). Mediabunny se importa en diferido: solo se descarga
 * cuando alguien elige un video de la galería.
 */

import { AUDIO_BITRATE, VIDEO_BITRATE, VIDEO_FRAME_RATE } from './constants'
import { MediaError } from './errors'

export interface WebCodecsResult {
  file: Blob
  /** `false` si el navegador no pudo recodificar el audio y salió mudo. */
  hasAudio: boolean
}

export interface WebCodecsOptions {
  width: number
  height: number
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

/** ¿Tiene este navegador lo mínimo para el camino WebCodecs? */
export function hasWebCodecs(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined'
  )
}

/**
 * Recodifica a MP4 (H.264, 480p, ~700 kbps; audio AAC u Opus a 64 kbps según
 * lo que pueda codificar el navegador, o sin audio si ninguno).
 *
 * Devuelve `null` si este navegador no puede hacerlo (el llamador cae al
 * camino de canvas + MediaRecorder). Lanza `canceled` si se aborta.
 */
export async function transcodeWithWebCodecs(
  source: Blob,
  options: WebCodecsOptions,
): Promise<WebCodecsResult | null> {
  const { signal, onProgress } = options
  if (!hasWebCodecs()) return null

  const mb = await import('mediabunny')
  const input = new mb.Input({
    source: new mb.BlobSource(source),
    formats: mb.ALL_FORMATS,
  })
  const target = new mb.BufferTarget()
  const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target })

  try {
    const conversion = await mb.Conversion.init({
      input,
      output,
      video: {
        width: options.width,
        height: options.height,
        fit: 'fill',
        codec: 'avc',
        bitrate: VIDEO_BITRATE,
        frameRate: VIDEO_FRAME_RATE,
        forceTranscode: true,
      },
      // Sin `codec`: Mediabunny elige entre los que el MP4 admite y el
      // navegador sabe codificar (AAC primero, después Opus). Si no hay
      // ninguno, la pista de audio se descarta y el video sale mudo.
      audio: { bitrate: AUDIO_BITRATE, forceTranscode: true },
      showWarnings: false,
    })

    const hasVideo = conversion.utilizedTracks.some((track) =>
      track.isVideoTrack(),
    )
    if (!conversion.isValid || !hasVideo) return null

    const hasAudio = conversion.utilizedTracks.some((track) =>
      track.isAudioTrack(),
    )

    conversion.onProgress = (fraction) => onProgress?.(fraction)
    const onAbort = () => void conversion.cancel()
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      await conversion.execute()
    } catch (error) {
      if (error instanceof mb.ConversionCanceledError || signal?.aborted) {
        throw new MediaError('canceled')
      }
      throw error
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }

    const buffer = target.buffer
    if (!buffer) return null
    return { file: new Blob([buffer], { type: 'video/mp4' }), hasAudio }
  } finally {
    input.dispose()
  }
}
