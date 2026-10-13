/**
 * `compressVideo` (módulo H, §3 y H-06): para los videos que se eligen de la
 * galería.
 *
 * 1. Rechaza antes de procesar si dura más de 30 s (con 0,5 s de tolerancia).
 * 2. Camino principal: WebCodecs + muxer MP4 (Mediabunny) a 480p y ~700 kbps.
 * 3. Si el navegador no puede, o el camino principal falla: canvas +
 *    `MediaRecorder` en tiempo real (tarda lo que dura el video).
 * 4. Rechaza si el resultado pasa de 20 MB.
 *
 * Sin ffmpeg.wasm (pesa unos 30 MB y se cuelga en teléfonos económicos).
 */

import {
  VIDEO_DURATION_TOLERANCE_S,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
  VIDEO_SHORT_SIDE_PX,
} from './constants'
import { MediaError, isMediaError } from './errors'
import { transcodeWithWebCodecs } from './compressVideoWebCodecs'
import { canRecordRealtime, transcodeRealtime } from './compressVideoRealtime'
import type { ProcessedMedia } from './types'
import {
  captureVideoThumbnail,
  makePlaceholderThumbnail,
  readVideoInfo,
  videoOutputSize,
} from './videoFrames'

export type CompressVideoMode = 'webcodecs' | 'realtime'

export interface CompressVideoProgress {
  /** 0 a 1. */
  fraction: number
  /** Camino que se está usando. En `realtime` hay que avisar que la pantalla tiene que quedar abierta. */
  mode: CompressVideoMode
}

export interface CompressVideoOptions {
  signal?: AbortSignal
  onProgress?: (progress: CompressVideoProgress) => void
}

/** Rechazo temprano por duración: se llama también desde la UI si quiere avisar antes. */
export function assertVideoDuration(durationSeconds: number): void {
  if (durationSeconds > VIDEO_MAX_SECONDS + VIDEO_DURATION_TOLERANCE_S) {
    throw new MediaError('video_too_long')
  }
}

export async function compressVideo(
  file: Blob,
  options: CompressVideoOptions = {},
): Promise<ProcessedMedia> {
  const { signal, onProgress } = options
  if (file.type && !file.type.startsWith('video/')) {
    throw new MediaError('unsupported_file')
  }
  if (signal?.aborted) throw new MediaError('canceled')

  // 1. Duración y tamaño, antes de gastar batería en procesar.
  const info = await readVideoInfo(file)
  assertVideoDuration(info.durationSeconds)
  const size = videoOutputSize(info.width, info.height, VIDEO_SHORT_SIDE_PX)
  const lastModified = file instanceof File ? file.lastModified : 0

  let output: Blob | null = null
  let mode: CompressVideoMode = 'webcodecs'
  let mimeType: ProcessedMedia['mimeType'] = 'video/mp4'
  let extension: ProcessedMedia['extension'] = 'mp4'
  let hasAudio = true

  // 2. Camino principal.
  try {
    const result = await transcodeWithWebCodecs(file, {
      ...size,
      signal,
      onProgress: (fraction) => onProgress?.({ fraction, mode: 'webcodecs' }),
    })
    if (result) {
      output = result.file
      hasAudio = result.hasAudio
    }
  } catch (error) {
    if (isMediaError(error) && error.code === 'canceled') throw error
    if (signal?.aborted) throw new MediaError('canceled')
    // Cualquier otro fallo del camino principal (códec, memoria, bug de un
    // navegador puntual): se intenta el fallback en vez de perder el video.
    output = null
  }

  // 3. Fallback en tiempo real.
  if (!output) {
    if (!canRecordRealtime()) throw new MediaError('compression_failed')
    mode = 'realtime'
    onProgress?.({ fraction: 0, mode })
    const result = await transcodeRealtime(file, {
      ...size,
      signal,
      onProgress: (fraction) => onProgress?.({ fraction, mode: 'realtime' }),
    })
    output = result.file
    hasAudio = result.hasAudio
    mimeType = result.format.mimeType
    extension = result.format.extension
  }

  // 4. Tope de 20 MB ya comprimido.
  if (output.size > VIDEO_MAX_BYTES) throw new MediaError('video_too_large')

  // 5. Miniatura: un cuadro del video original (no se pierde nada por
  // sacarla del archivo sin recomprimir).
  let thumbnail: Blob
  try {
    thumbnail = await captureVideoThumbnail(
      file,
      Math.min(1, info.durationSeconds / 2),
    )
  } catch {
    thumbnail = await makePlaceholderThumbnail(size.width, size.height)
  }

  return {
    kind: 'video',
    file: output,
    mimeType,
    extension,
    thumbnail,
    width: size.width,
    height: size.height,
    bytes: output.size,
    thumbnailBytes: thumbnail.size,
    totalBytes: output.size + thumbnail.size,
    durationSeconds: Math.round(info.durationSeconds * 10) / 10,
    capturedAt: lastModified > 0 ? new Date(lastModified) : null,
    mode,
    hasAudio,
  }
}
