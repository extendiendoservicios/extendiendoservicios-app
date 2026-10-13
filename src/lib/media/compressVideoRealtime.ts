/**
 * Fallback de `compressVideo`: se reproduce el video en un <video> oculto,
 * se dibuja cuadro a cuadro en un canvas y se graba con `MediaRecorder`.
 *
 * Tarda lo que dura el video y la pantalla tiene que quedar abierta (el
 * navegador pausa `requestAnimationFrame` en una pestaña en segundo plano).
 * El audio se toma con Web Audio (`createMediaElementSource`) sin conectarlo
 * a los parlantes, así que no suena mientras se procesa. Si el navegador no
 * deja reproducir con sonido sin un toque de la persona, se reintenta mudo y
 * el resultado sale sin audio (`hasAudio: false`).
 */

import { AUDIO_BITRATE, VIDEO_BITRATE, VIDEO_FRAME_RATE } from './constants'
import { createCanvas, getContext2d } from './canvas'
import { MediaError } from './errors'
import { pickRecorderFormat, type RecorderFormat } from './mimeTypes'

export interface RealtimeResult {
  file: Blob
  format: RecorderFormat
  hasAudio: boolean
}

export interface RealtimeOptions {
  width: number
  height: number
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

export function canRecordRealtime(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    pickRecorderFormat() !== null &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  )
}

export async function transcodeRealtime(
  source: Blob,
  options: RealtimeOptions,
): Promise<RealtimeResult> {
  const { width, height, signal, onProgress } = options
  const format = pickRecorderFormat()
  if (!format || !canRecordRealtime()) {
    throw new MediaError('compression_failed')
  }
  if (signal?.aborted) throw new MediaError('canceled')

  const url = URL.createObjectURL(source)
  const video = document.createElement('video')
  video.playsInline = true
  video.preload = 'auto'
  video.src = url

  const canvas = createCanvas(width, height)
  const context = getContext2d(canvas)

  let audioContext: AudioContext | null = null
  let rafId = 0
  let recorder: MediaRecorder | null = null
  let canvasStream: MediaStream | null = null
  let audioStream: MediaStream | null = null

  const cleanup = () => {
    cancelAnimationFrame(rafId)
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
    canvasStream?.getTracks().forEach((t) => t.stop())
    audioStream?.getTracks().forEach((t) => t.stop())
    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close().catch(() => undefined)
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new MediaError('video_unreadable'))
    })

    canvasStream = canvas.captureStream(VIDEO_FRAME_RATE)
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()]

    // Audio por Web Audio, sin pasar por los parlantes.
    let hasAudio = false
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (Ctx) {
        audioContext = new Ctx()
        const node = audioContext.createMediaElementSource(video)
        const destination = audioContext.createMediaStreamDestination()
        node.connect(destination)
        audioStream = destination.stream
        const audioTracks = audioStream.getAudioTracks()
        tracks.push(...audioTracks)
        hasAudio = audioTracks.length > 0
      }
    } catch {
      hasAudio = false
    }

    try {
      await video.play()
    } catch {
      // Sin permiso para reproducir con sonido: mudo.
      video.muted = true
      hasAudio = false
      await video.play()
    }

    const mixed = new MediaStream(tracks)
    recorder = new MediaRecorder(mixed, {
      mimeType: format.recorderType,
      videoBitsPerSecond: VIDEO_BITRATE,
      audioBitsPerSecond: AUDIO_BITRATE,
    })
    const chunks: Blob[] = []
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    })

    const finished = new Promise<void>((resolve, reject) => {
      const active = recorder
      if (!active) return reject(new MediaError('compression_failed'))
      active.addEventListener('stop', () => resolve())
      active.addEventListener('error', () =>
        reject(new MediaError('compression_failed')),
      )
      video.addEventListener('ended', () => {
        if (active.state !== 'inactive') active.stop()
      })
      video.addEventListener('error', () =>
        reject(new MediaError('video_unreadable')),
      )
      signal?.addEventListener(
        'abort',
        () => {
          if (active.state !== 'inactive') active.stop()
          reject(new MediaError('canceled'))
        },
        { once: true },
      )
    })

    const draw = () => {
      context.drawImage(video, 0, 0, width, height)
      if (video.duration > 0) {
        onProgress?.(Math.min(1, video.currentTime / video.duration))
      }
      rafId = requestAnimationFrame(draw)
    }
    recorder.start(1000)
    draw()

    await finished
    const file = new Blob(chunks, { type: format.mimeType })
    if (file.size === 0) throw new MediaError('compression_failed')
    onProgress?.(1)
    return { file, format, hasAudio }
  } finally {
    cleanup()
  }
}
