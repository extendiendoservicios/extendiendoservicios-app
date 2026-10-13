/**
 * `recordVideo` (módulo H, §3 y H-06): grabación dentro de la app con
 * `getUserMedia` (cámara trasera, 854×480) y `MediaRecorder` a ~700 kbps de
 * video y 64 kbps de audio, con corte automático a los 30 s. Sale directo en
 * unos 3 MB: no se vuelve a comprimir.
 *
 * Es una sesión en dos tiempos, porque la pantalla de grabación primero
 * muestra la vista previa y recién después la persona toca «Grabar»:
 *
 *   const session = await recordVideo({ onTick })
 *   video.srcObject = session.stream      // vista previa
 *   session.start()                       // empieza a grabar
 *   const media = await session.result    // al detener o a los 30 s
 *   session.dispose()                     // libera la cámara (siempre)
 */

import {
  AUDIO_BITRATE,
  VIDEO_BITRATE,
  VIDEO_FRAME_RATE,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
  VIDEO_RECORD_HEIGHT,
  VIDEO_RECORD_WIDTH,
} from './constants'
import { makeThumbnail } from './canvas'
import { MediaError } from './errors'
import { pickRecorderFormat, type RecorderFormat } from './mimeTypes'
import type { ProcessedMedia } from './types'
import { makePlaceholderThumbnail } from './videoFrames'

export interface RecordVideoOptions {
  /** Corte automático, en segundos. Por defecto 30 (H-06). */
  maxSeconds?: number
  /** Se llama unas 5 veces por segundo con los segundos que faltan. */
  onTick?: (remainingSeconds: number, elapsedSeconds: number) => void
}

export interface VideoRecorderSession {
  /** Para la vista previa: `<video muted playsInline srcObject={stream}>`. */
  stream: MediaStream
  /** Formato elegido (`video/mp4` en iPhone, `video/webm` en Android). */
  format: RecorderFormat
  /** Empieza a grabar. */
  start: () => void
  /** Detiene la grabación; `result` se resuelve. */
  stop: () => void
  /** Libera la cámara y el micrófono. Si se llama grabando, cancela y descarta. */
  dispose: () => void
  /** Se resuelve al detener (o a los 30 s). Rechaza con `canceled` si se descartó. */
  result: Promise<ProcessedMedia>
}

function cameraError(error: unknown): MediaError {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new MediaError('camera_denied')
  }
  return new MediaError('camera_unavailable')
}

async function openStream(): Promise<MediaStream> {
  const devices = navigator.mediaDevices as MediaDevices | undefined
  if (!devices?.getUserMedia) throw new MediaError('recording_unsupported')
  const video: MediaTrackConstraints = {
    facingMode: { ideal: 'environment' },
    width: { ideal: VIDEO_RECORD_WIDTH },
    height: { ideal: VIDEO_RECORD_HEIGHT },
    frameRate: { ideal: VIDEO_FRAME_RATE },
  }
  try {
    return await devices.getUserMedia({ video, audio: true })
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    // Sin micrófono: se graba igual, mudo, antes que no grabar.
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      try {
        return await devices.getUserMedia({ video, audio: false })
      } catch (second) {
        throw cameraError(second)
      }
    }
    throw cameraError(error)
  }
}

export async function recordVideo(
  options: RecordVideoOptions = {},
): Promise<VideoRecorderSession> {
  const maxSeconds = options.maxSeconds ?? VIDEO_MAX_SECONDS
  if (typeof MediaRecorder === 'undefined') {
    throw new MediaError('recording_unsupported')
  }
  const format = pickRecorderFormat()
  if (!format) throw new MediaError('recording_unsupported')

  const stream = await openStream()
  const track = stream.getVideoTracks()[0]
  const settings = track?.getSettings() ?? {}
  const width = settings.width ?? VIDEO_RECORD_WIDTH
  const height = settings.height ?? VIDEO_RECORD_HEIGHT

  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: format.recorderType,
      videoBitsPerSecond: VIDEO_BITRATE,
      audioBitsPerSecond: AUDIO_BITRATE,
    })
  } catch {
    stream.getTracks().forEach((t) => t.stop())
    throw new MediaError('recording_unsupported')
  }

  const chunks: Blob[] = []
  let startedAt = 0
  let timer: ReturnType<typeof setInterval> | null = null
  let frameTimer: ReturnType<typeof setTimeout> | null = null
  let thumbnail: Blob | null = null
  let started = false
  let finished = false
  let discarded = false

  // Un <video> en memoria alimentado por el mismo stream, para sacar un
  // cuadro de la miniatura sin tener que reproducir el archivo grabado
  // (un WebM de MediaRecorder no trae duración y no se puede buscar bien).
  const probe = document.createElement('video')
  probe.muted = true
  probe.playsInline = true
  probe.srcObject = stream
  void Promise.resolve(probe.play()).catch(() => undefined)

  async function grabFrame() {
    if (thumbnail || !probe.videoWidth) return
    try {
      thumbnail = await makeThumbnail(
        probe,
        probe.videoWidth,
        probe.videoHeight,
      )
    } catch {
      thumbnail = null
    }
  }

  let resolveResult!: (media: ProcessedMedia) => void
  let rejectResult!: (error: MediaError) => void
  const result = new Promise<ProcessedMedia>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  // Si nadie espera `result` (se descartó antes de grabar), no es un error sin manejar.
  result.catch(() => undefined)

  function clearTimers() {
    if (timer) clearInterval(timer)
    if (frameTimer) clearTimeout(frameTimer)
    timer = null
    frameTimer = null
  }

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data)
  })

  recorder.addEventListener('error', () => {
    finished = true
    clearTimers()
    rejectResult(new MediaError('recording_failed'))
  })

  recorder.addEventListener('stop', () => {
    clearTimers()
    if (discarded) {
      rejectResult(new MediaError('canceled'))
      return
    }
    void (async () => {
      const elapsed = (performance.now() - startedAt) / 1000
      await grabFrame()
      const file = new Blob(chunks, { type: format.mimeType })
      if (file.size === 0) {
        rejectResult(new MediaError('recording_failed'))
        return
      }
      if (file.size > VIDEO_MAX_BYTES) {
        rejectResult(new MediaError('video_too_large'))
        return
      }
      const thumb = thumbnail ?? (await makePlaceholderThumbnail(width, height))
      const durationSeconds =
        Math.round(Math.min(elapsed, maxSeconds) * 10) / 10
      resolveResult({
        kind: 'video',
        file,
        mimeType: format.mimeType,
        extension: format.extension,
        thumbnail: thumb,
        width,
        height,
        bytes: file.size,
        thumbnailBytes: thumb.size,
        totalBytes: file.size + thumb.size,
        durationSeconds,
        capturedAt: new Date(Date.now() - elapsed * 1000),
      })
    })().catch(() => rejectResult(new MediaError('recording_failed')))
  })

  function stop() {
    if (!started || finished) return
    finished = true
    clearTimers()
    if (recorder.state !== 'inactive') recorder.stop()
  }

  return {
    stream,
    format,
    result,
    start() {
      if (started) return
      started = true
      startedAt = performance.now()
      recorder.start(1000)
      options.onTick?.(maxSeconds, 0)
      frameTimer = setTimeout(() => void grabFrame(), 1000)
      timer = setInterval(() => {
        const elapsed = (performance.now() - startedAt) / 1000
        options.onTick?.(Math.max(0, Math.ceil(maxSeconds - elapsed)), elapsed)
        if (elapsed >= maxSeconds) stop()
      }, 200)
    },
    stop,
    dispose() {
      clearTimers()
      if (started && !finished) {
        discarded = true
        finished = true
        if (recorder.state !== 'inactive') recorder.stop()
      } else if (!started) {
        rejectResult(new MediaError('canceled'))
      }
      stream.getTracks().forEach((t) => t.stop())
      probe.srcObject = null
    },
  }
}
